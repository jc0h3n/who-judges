// Joins the sources into site/data/judges.json. Run after fetch.mjs: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const read = f => readFileSync(f, "utf8");
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i].trim()])));
}
const fjc = f => parseCSV(read(`raw/fjc-${f}.csv`));
const dayNum = s => s ? Math.round(Date.parse(s + "T00:00:00Z") / 864e5) : null;   // days since 1970, compact

// ---- Shared vocabularies -------------------------------------------------------------------------------
// Race and ethnicity: one exclusive group per person (Hispanic of any race counts as Hispanic, as in the
// Census Bureau's tables), plus flags so "Black" can also be counted the way BLS and Census count it.
const RACES = ["White", "Black", "Hispanic", "Asian American", "Native American", "Pacific Islander", "Middle Eastern/North African", "Multiracial", "Not reported"];
function raceOf(label) {
  const s = label || "";
  const f = {
    black: /African American|Afro-/i.test(s), hispanic: /Hispanic|Latino|Cuban American|Afro-Latino/i.test(s),
    asian: /Asian American|Korean|South Asian|Pakistani/i.test(s), native: /American Indian/i.test(s),
    pacific: /Pacific Islander/i.test(s), mena: /Middle Eastern|Chaldean/i.test(s), white: /White|Portuguese/i.test(s)
  };
  const nonWhite = ["black", "asian", "native", "pacific", "mena"].filter(k => f[k]);
  let group;
  if (!s || /declined|other/i.test(s) && !nonWhite.length && !f.hispanic) group = "Not reported";
  else if (f.hispanic) group = "Hispanic";
  else if (nonWhite.length > 1) group = "Multiracial";
  else if (nonWhite.length === 1) group = { black: "Black", asian: "Asian American", native: "Native American", pacific: "Pacific Islander", mena: "Middle Eastern/North African" }[nonWhite[0]];
  else group = "White";
  return { group, ...f };
}

const IVY = new Set(["Harvard", "Yale", "Princeton", "Columbia", "Pennsylvania", "Brown", "Dartmouth", "Cornell"]);
// Law schools are reported under many names; reduce to the university, e.g. "Harvard Law School" -> "Harvard".
const SCHOOL_ALIASES = [
  [/harvard/i, "Harvard"], [/yale/i, "Yale"], [/columbia/i, "Columbia"], [/stanford/i, "Stanford"], [/university of chicago|chicago law/i, "Chicago"],
  [/new york university|nyu/i, "NYU"], [/university of pennsylvania|^penn\b/i, "Pennsylvania"], [/georgetown/i, "Georgetown"],
  [/university of virginia|^virginia$/i, "Virginia"], [/university of michigan|^michigan$/i, "Michigan"], [/duke/i, "Duke"], [/northwestern/i, "Northwestern"],
  [/cornell/i, "Cornell"], [/university of texas|^texas$|^ut austin/i, "Texas"], [/(uc|university of california)[-, ]+berkeley|boalt|^berkeley$/i, "UC Berkeley"],
  [/ucla|university of california[-, ]+los angeles/i, "UCLA"], [/hastings|uc law sf/i, "UC Hastings / UC Law SF"], [/george washington/i, "George Washington"],
  [/vanderbilt/i, "Vanderbilt"], [/notre dame/i, "Notre Dame"], [/fordham/i, "Fordham"], [/boston university/i, "Boston University"], [/boston college/i, "Boston College"],
  [/emory/i, "Emory"], [/tulane/i, "Tulane"], [/princeton/i, "Princeton"], [/brown/i, "Brown"], [/dartmouth/i, "Dartmouth"],
  [/samford|cumberland/i, "Samford (Cumberland)"], [/southern methodist|\bsmu\b/i, "SMU"], [/baylor/i, "Baylor"], [/university of florida|^florida$/i, "Florida"],
  [/university of georgia|^georgia$/i, "Georgia"], [/university of alabama|^alabama$/i, "Alabama"], [/louisiana state|\blsu\b/i, "LSU"],
  [/university of minnesota|^minnesota$/i, "Minnesota"], [/university of wisconsin|^wisconsin$/i, "Wisconsin"], [/university of iowa|^iowa$/i, "Iowa"],
  [/indiana university|^indiana$/i, "Indiana"], [/ohio state/i, "Ohio State"], [/university of washington|^washington$/i, "Washington"],
  [/university of north carolina|^unc$|^north carolina$/i, "North Carolina"], [/university of kentucky|^kentucky$/i, "Kentucky"],
  [/university of tennessee|^tennessee$/i, "Tennessee"], [/university of mississippi|ole miss|^mississippi$/i, "Mississippi"],
  [/university of south carolina|^south carolina$/i, "South Carolina"], [/university of arkansas|^arkansas$/i, "Arkansas"],
  [/university of oklahoma|^oklahoma$/i, "Oklahoma"], [/university of kansas|^kansas$/i, "Kansas"], [/university of missouri|^missouri$/i, "Missouri"],
  [/university of colorado|^colorado$/i, "Colorado"], [/university of arizona|^arizona$/i, "Arizona"], [/arizona state/i, "Arizona State"],
  [/university of utah|^utah$/i, "Utah"], [/brigham young|\bbyu\b/i, "BYU"], [/university of houston|^houston$/i, "Houston"], [/st\.? mary'?s/i, "St. Mary's"],
  [/south texas/i, "South Texas"], [/texas tech/i, "Texas Tech"], [/catholic university/i, "Catholic University"], [/american university/i, "American University"],
  [/howard/i, "Howard"], [/rutgers/i, "Rutgers"], [/seton hall/i, "Seton Hall"], [/villanova/i, "Villanova"], [/temple/i, "Temple"], [/pittsburgh/i, "Pittsburgh"],
  [/william (&|and) mary/i, "William & Mary"], [/university of richmond|^richmond$/i, "Richmond"], [/washington and lee|washington & lee/i, "Washington and Lee"],
  [/george mason/i, "George Mason"], [/st\.? john'?s/i, "St. John's"], [/brooklyn law/i, "Brooklyn"], [/albany/i, "Albany"], [/syracuse/i, "Syracuse"],
  [/university of connecticut|^connecticut$|uconn/i, "Connecticut"], [/suffolk/i, "Suffolk"], [/northeastern/i, "Northeastern"],
  [/loyola/i, "Loyola"], [/marquette/i, "Marquette"], [/creighton/i, "Creighton"], [/drake/i, "Drake"], [/wake forest/i, "Wake Forest"],
  [/university of miami|^miami$/i, "Miami"], [/stetson/i, "Stetson"], [/mercer/i, "Mercer"], [/university of denver|^denver$/i, "Denver"],
  [/lewis (&|and) clark/i, "Lewis & Clark"], [/willamette/i, "Willamette"], [/gonzaga/i, "Gonzaga"], [/university of oregon|^oregon$/i, "Oregon"],
  [/university of nebraska|^nebraska$/i, "Nebraska"], [/university of montana|^montana$/i, "Montana"], [/university of wyoming|^wyoming$/i, "Wyoming"],
  [/university of idaho|^idaho$/i, "Idaho"], [/university of new mexico|^new mexico$/i, "New Mexico"], [/university of hawai/i, "Hawaii"],
  [/university of maine|^maine$/i, "Maine"], [/university of north dakota|^north dakota$/i, "North Dakota"], [/university of south dakota|^south dakota$/i, "South Dakota"],
  [/west virginia/i, "West Virginia"], [/university of maryland|^maryland$/i, "Maryland"], [/university of baltimore/i, "Baltimore"],
  [/university of louisville|^louisville$/i, "Louisville"], [/university of memphis|^memphis$/i, "Memphis"], [/university of cincinnati|^cincinnati$/i, "Cincinnati"],
  [/case western/i, "Case Western"], [/wayne state/i, "Wayne State"], [/detroit/i, "Detroit Mercy"], [/thomas m\.? cooley/i, "Cooley"],
  [/university of southern california|^usc$/i, "USC"], [/pepperdine/i, "Pepperdine"], [/santa clara/i, "Santa Clara"], [/mcgeorge/i, "McGeorge"],
  [/uc davis|university of california[-, ]+davis/i, "UC Davis"], [/irvine/i, "UC Irvine"], [/san diego/i, "San Diego"], [/golden gate/i, "Golden Gate"],
  [/university of san francisco/i, "San Francisco"], [/southwestern/i, "Southwestern"], [/new york law school|^nyls$/i, "New York Law School"],
  [/hofstra/i, "Hofstra"], [/cardozo/i, "Cardozo"], [/university at buffalo|suny buffalo|^buffalo$/i, "Buffalo"], [/vermont/i, "Vermont"],
  [/university of illinois|^illinois$/i, "Illinois"], [/john marshall/i, "John Marshall"], [/kent/i, "Chicago-Kent"], [/depaul/i, "DePaul"],
  [/saint louis|st\.? louis/i, "Saint Louis"], [/washington university/i, "Washington University"], [/university of virginia/i, "Virginia"],
  [/university of puerto rico/i, "Puerto Rico"], [/inter american/i, "Inter American"], [/faulkner|thomas goode jones/i, "Faulkner (Jones)"],
  [/university of nevada|boyd/i, "UNLV (Boyd)"], [/university of pacific/i, "McGeorge"]
];
const schoolName = s => { for (const [re, n] of SCHOOL_ALIASES) if (re.test(s)) return n; return s.replace(/,? (School|College|Faculty) of Law.*$|,? Law School.*$|,? Law Center.*$|,? Law$/i, "").replace(/^The /, "").trim(); };

// Careers before the bench, from the FJC's career entries
const CAREERS = [
  ["Private practice", /private practice/i],
  ["Federal prosecutor", /(assistant |special assistant |interim |acting )?(u\.?\s?s\.?|united states) attorney/i],
  ["State or local prosecutor", /district attorney|prosecut|state'?s attorney|county attorney|commonwealth'?s attorney|county prosecutor|city attorney|solicitor,? (\w+ )?(judicial )?circuit/i],
  ["Public defender", /public defender|federal (public )?defender|defender (association|services|office)|legal aid/i],
  ["State or local judge", null],   // classified below
  ["Magistrate or bankruptcy judge", /magistrate judge|u\.?s\.? magistrate|bankruptcy judge|u\.?s\.? commissioner/i],
  ["Law clerk", /law clerk|clerk to (the )?hon|clerk,? hon/i],
  ["Law professor", /professor|law school faculty|lecturer|instructor|dean,/i],
  ["Military", /u\.?s\.? (army|navy|air force|marine corps|coast guard)|judge advocate|jag corps|military/i],
  ["Elected office", /(state|u\.?s\.?) (senate|house|representative|senator)|member,? (\w+ )?(house of (representatives|delegates)|state senate|state assembly|general assembly|legislature|city council|congress)|mayor|governor,|lieutenant governor|attorney general of/i]
];
const FEDERAL_COURT = /u\.?s\.?|united states|federal|tax court|court of (federal )?claims|military|veterans|court of international trade|customs/i;
function careersOf(entries) {
  const out = new Set();
  for (const e of entries) {
    for (const [name, re] of CAREERS) if (re && re.test(e)) out.add(name);
    if (/^(judge|justice|associate justice|chief justice|chief judge|presiding judge|associate judge|special judge|probate judge|municipal judge|justice of the peace)\b/i.test(e) && !FEDERAL_COURT.test(e)) out.add("State or local judge");
  }
  return [...out];
}

// ---- Federal judges (FJC) -------------------------------------------------------------------------------
const dem = fjc("demographics"), edu = fjc("education"), svc = fjc("federal-judicial-service"), car = fjc("professional-career");
// Earlier federal service as a magistrate or bankruptcy judge, or on the D.C. local courts, is kept in a separate file
const other = fjc("other-federal-judicial-service");
const otherBy = other.reduce((m, r) => ((m[r.nid] ||= []).push(r.Type), m), {});
const byNid = (rows) => rows.reduce((m, r) => ((m[r.nid] ||= []).push(r), m), {});
const eduBy = byNid(edu), carBy = byNid(car);

const LAW_DEGREE = /^(j\.?d|ll\.?b|ll\.?m|j\.?s\.?d|s\.?j\.?d|b\.?c\.?l|j\.?u\.?d|d\.?c\.?l|law)/i;
const schools = new Map(), schoolIdx = s => { if (!schools.has(s)) schools.set(s, schools.size); return schools.get(s); };
const judges = dem.map(d => {
  const ed = (eduBy[d.nid] || []).sort((a, b) => a.Sequence - b.Sequence);
  const law = ed.filter(e => LAW_DEGREE.test(e.Degree) || /law/i.test(e.School));
  const firstLaw = law.find(e => !/^ll\.?m|^s\.?j\.?d|^j\.?s\.?d/i.test(e.Degree)) || law[0];
  const lawSchool = firstLaw ? schoolName(firstLaw.School) : null;
  const allSchools = [...new Set(ed.map(e => schoolName(e.School)))];
  const r = raceOf(d["Race or Ethnicity"]);
  const careers = careersOf((carBy[d.nid] || []).map(c => c["Professional Career"]));
  for (const t of otherBy[d.nid] || []) {
    if (/magistrate|bankruptcy|commissioner/i.test(t) && !careers.includes("Magistrate or bankruptcy judge")) careers.push("Magistrate or bankruptcy judge");
    if (/District of Columbia Courts|Territorial Courts/i.test(t) && !careers.includes("State or local judge")) careers.push("State or local judge");
  }
  return {
    nid: d.nid,
    name: [d["First Name"], d["Middle Name"], d["Last Name"], d.Suffix].filter(x => x && x.trim()).join(" ").replace(/\s+/g, " "),
    last: d["Last Name"], gender: d.Gender === "Female" ? "F" : d.Gender === "Male" ? "M" : null,
    born: d["Birth Year"] ? +d["Birth Year"] : null, died: d["Death Year"] ? +d["Death Year"] : null,
    raceLabel: d["Race or Ethnicity"], race: r,
    lawSchool: lawSchool ? schoolIdx(lawSchool) : -1, schools: allSchools.map(schoolIdx),
    ivy: allSchools.some(s => IVY.has(s)),
    careers
  };
});
const jIndex = new Map(judges.map((j, i) => [j.nid, i]));

const COURT_TYPES = { "Supreme Court": "Supreme Court", "U.S. Court of Appeals": "Courts of appeals", "U.S. District Court": "District courts" };
const courtTypeOf = t => COURT_TYPES[t] || "Other Article III courts";
const STATE_ABBR = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR", "Virgin Islands": "VI", Guam: "GU", "Canal Zone": "CZ", "Northern Mariana Islands": "MP" };
const stateOfCourt = name => { for (const [s, a] of Object.entries(STATE_ABBR).sort((a, b) => b[0].length - a[0].length)) if (name.includes(s)) return a; return null; };
const circuitOf = name => { const m = name.match(/(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|District of Columbia|Federal) Circuit/); return m ? m[1] : null; };
const DISTRICT_CIRCUIT = { ME: "First", MA: "First", NH: "First", RI: "First", PR: "First", CT: "Second", NY: "Second", VT: "Second", DE: "Third", NJ: "Third", PA: "Third", VI: "Third",
  MD: "Fourth", NC: "Fourth", SC: "Fourth", VA: "Fourth", WV: "Fourth", LA: "Fifth", MS: "Fifth", TX: "Fifth", CZ: "Fifth", KY: "Sixth", MI: "Sixth", OH: "Sixth", TN: "Sixth",
  IL: "Seventh", IN: "Seventh", WI: "Seventh", AR: "Eighth", IA: "Eighth", MN: "Eighth", MO: "Eighth", NE: "Eighth", ND: "Eighth", SD: "Eighth",
  AK: "Ninth", AZ: "Ninth", CA: "Ninth", HI: "Ninth", ID: "Ninth", MT: "Ninth", NV: "Ninth", OR: "Ninth", WA: "Ninth", GU: "Ninth", MP: "Ninth",
  CO: "Tenth", KS: "Tenth", NM: "Tenth", OK: "Tenth", UT: "Tenth", WY: "Tenth", AL: "Eleventh", FL: "Eleventh", GA: "Eleventh", DC: "District of Columbia" };

const presidents = new Map(), presIdx = p => { if (!presidents.has(p)) presidents.set(p, presidents.size); return presidents.get(p); };
const courts = new Map(), courtIdx = c => { if (!courts.has(c)) courts.set(c, courts.size); return courts.get(c); };
const ABA = ["Exceptionally Well Qualified", "Well Qualified", "Qualified", "Not Qualified"];
const services = svc.filter(s => s["Commission Date"] || s["Recess Appointment Date"]).map(s => {
  const type = courtTypeOf(s["Court Type"]);
  const st = type === "District courts" ? stateOfCourt(s["Court Name"]) : null;
  const circuit = type === "Courts of appeals" ? circuitOf(s["Court Name"]) : st ? DISTRICT_CIRCUIT[st] || null : null;
  const party = s["Party of Appointing President"];
  const votes = (s["Ayes/Nays"] || "").match(/(\d+)\s*\/\s*(\d+)/);
  const aba = s["ABA Rating"].replace("Not Qualified By Reason of Age", "Not Qualified").replace("Qualified/Well Qualified", "Qualified");
  return {
    j: jIndex.get(s.nid), court: courtIdx(s["Court Name"]), type, st, circuit,
    title: s["Appointment Title"],
    pres: s["Appointing President"] ? presIdx(s["Appointing President"]) : -1,
    party: /^(Republican|Democratic)$/.test(party) ? party : party.startsWith("None") ? "Reassignment" : party || "Unknown",
    aba: ABA.indexOf(aba),
    nominated: dayNum(s["Nomination Date"]), confirmed: dayNum(s["Confirmation Date"]),
    start: dayNum(s["Commission Date"] || s["Recess Appointment Date"]),
    senior: dayNum(s["Senior Status Date"]), end: dayNum(s["Termination Date"]),
    ayes: votes ? +votes[1] : null, nays: votes ? +votes[2] : null, voice: s["Senate Vote Type"] === "Voice"
  };
}).filter(s => s.j != null);

// ---- State high courts (Wikipedia + Wikidata) -------------------------------------------------------------
const stateRaw = JSON.parse(read("data/state-justices.json"));
const catRace = cats => {
  const c = cats.join("\n");
  const f = {
    black: /African[- ]American|Black (Americans|conservatism|women|people)|Afro-/i.test(c),
    hispanic: /Hispanic|Latin[oa]|of (Mexican|Cuban|Puerto Rican|Dominican|Salvadoran|Colombian|Guatemalan|Honduran|Venezuelan|Peruvian|Argentine|Nicaraguan|Ecuadorian|Chilean|Panamanian) descent|Puerto Rican/i.test(c),
    asian: /Asian[- ]American|Asian descent|Asian conservatism|of (Chinese|Japanese|Korean|Filipino|Vietnamese|Indian|Taiwanese|Pakistani|Thai|Cambodian|Hmong|Laotian|Bangladeshi|Sri Lankan) descent|(Japanese|Korean|Chinese|Filipino|Vietnamese|Indian|Taiwanese) emigrants/i.test(c),
    native: /Native American|Alaska Native|Cherokee|Navajo|Choctaw|Chickasaw|Muscogee|Ojibwe|Lakota|Osage|Seminole|Pueblo/i.test(c),
    pacific: /Native Hawaiian|Pacific Islander|Samoan|Chamorro/i.test(c)
  };
  const nonWhite = ["black", "asian", "native", "pacific"].filter(k => f[k]);
  const group = f.hispanic ? "Hispanic" : nonWhite.length > 1 ? "Multiracial" : nonWhite.length ? { black: "Black", asian: "Asian American", native: "Native American", pacific: "Pacific Islander" }[nonWhite[0]] : "White or not recorded";
  return { group, ...f, lgbtq: /\bLGBTQ (judges|lawyers|people|appointed|state legislators|politicians|jurists)|^(American )?(gay|lesbian|bisexual)|(gay|lesbian|bisexual) (men|women|politicians|lawyers|judges)/im.test(c) && !/rights activists/i.test(c) };
};
const PARTY_ABBR = { R: "Republican", D: "Democratic", I: "Independent" };
const PRES_PARTY = { "G.W. Bush": "Republican", "George W. Bush": "Republican", Obama: "Democratic", Trump: "Republican", Biden: "Democratic", Reagan: "Republican", Clinton: "Democratic", "G.H.W. Bush": "Republican", Carter: "Democratic" };
const normParty = p => !p ? null : /DFL|Democrat/i.test(p) ? "Democratic" : /Republican/i.test(p) ? "Republican" : /Independent|Nonpartisan/i.test(p) ? "Independent" : p;
const justices = stateRaw.justices.map(j => {
  const appointerParty = normParty(j.appointerParty) || (j.appointer && (PARTY_ABBR[(j.appointer.match(/\(([RDI])\)/) || [])[1]] || PRES_PARTY[j.appointer.trim()])) || null;
  const lawSchool = j.lawSchool ? schoolName(j.lawSchool.replace(/\s*\(.*\)$/, "")) : (j.schools.find(s => /law/i.test(s.school) || LAW_DEGREE.test(s.degree || "")) ? schoolName(j.schools.find(s => /law/i.test(s.school) || LAW_DEGREE.test(s.degree || "")).school) : null);
  const allSchools = [...new Set([...(lawSchool ? [lawSchool] : []), ...j.schools.map(s => schoolName(s.school))])];
  return {
    st: j.st, court: j.court, name: j.name, wiki: j.wiki, chief: !!j.chief, gender: j.sex, born: j.born, start: j.start, termEnds: j.termEnds,
    selection: j.appointer ? "Appointed" : "Elected", appointer: j.appointer ? j.appointer.replace(/\s*\([RDI]\)\s*$/, "") : null,
    party: normParty(j.electedParty) || normParty(j.party) || appointerParty, partyBasis: (normParty(j.electedParty) || normParty(j.party)) ? "elected" : appointerParty ? "appointer" : null,
    race: catRace(j.categories), lawSchool, ivy: allSchools.some(s => IVY.has(s))
  };
});

// ---- Benchmarks ------------------------------------------------------------------------------------------
const bench = existsSync("data/benchmarks.json") ? JSON.parse(read("data/benchmarks.json")) : {};
const aba = JSON.parse(read("data/aba.json"));

// ---- Law schools of all new lawyers (ABA, classes since 2010), named the same way as judges' schools ----------------
// The ABA writes "MICHIGAN, UNIVERSITY OF"; flip to "University of Michigan" before matching.
const flip = s => s.replace(/^(.*?),\s*(The )?University of$/i, "University of $1").replace(/^(.*?),\s*(The )?(College|School) of Law$/i, "$1 $3 of Law");
let lawSchoolShares = null;
if (bench.lawSchools?.total) {
  lawSchoolShares = {};
  for (const [s, n] of Object.entries(bench.lawSchools.graduates)) { const k = schoolName(flip(s)); lawSchoolShares[k] = (lawSchoolShares[k] || 0) + n / bench.lawSchools.total; }
}

// ---- Output ----------------------------------------------------------------------------------------------
const schoolList = [...schools.keys()], presList = [...presidents.keys()], courtList = [...courts.keys()];
const out = {
  generated: new Date().toISOString().slice(0, 10),
  stateFetched: stateRaw.fetched,
  races: RACES, aba: ABA, schools: schoolList, ivy: schoolList.map(s => IVY.has(s) ? 1 : 0), presidents: presList, courts: courtList,
  careers: CAREERS.map(([n]) => n),
  // judges: [name, last, gender, born, died, raceGroupIdx, raceFlags(bitmask black1 hisp2 asian4 native8 pacific16 mena32), lawSchoolIdx, [schoolIdx], [careerIdx], raceLabel]
  judges: judges.map(j => [j.name, j.last, j.gender, j.born, j.died, RACES.indexOf(j.race.group),
    (j.race.black ? 1 : 0) | (j.race.hispanic ? 2 : 0) | (j.race.asian ? 4 : 0) | (j.race.native ? 8 : 0) | (j.race.pacific ? 16 : 0) | (j.race.mena ? 32 : 0),
    j.lawSchool, j.schools, j.careers.map(c => CAREERS.findIndex(([n]) => n === c)), j.raceLabel]),
  // services: [judgeIdx, courtIdx, type, state, circuit, presIdx, party, abaIdx, nominatedDay, confirmedDay, startDay, seniorDay, endDay, ayes, nays, voice, title]
  services: services.map(s => [s.j, s.court, s.type, s.st, s.circuit, s.pres, s.party, s.aba, s.nominated, s.confirmed, s.start, s.senior, s.end, s.ayes, s.nays, s.voice ? 1 : 0, s.title]),
  justices,
  // weekly log of state high-court changes since tracking began
  stateChanges: (existsSync("data/state-history.json") ? JSON.parse(read("data/state-history.json")) : []).filter(h => h.joined?.length || h.left?.length).map(h => ({ date: h.date, since: h.since, joined: h.joined, left: h.left })),
  stateTrackedSince: existsSync("data/state-history.json") ? (JSON.parse(read("data/state-history.json"))[0]?.date || null) : null,
  benchmarks: { ...bench, aba, lawSchools: bench.lawSchools ? { ...bench.lawSchools, graduates: undefined, shares: lawSchoolShares } : null }
};
mkdirSync("site/data", { recursive: true });
writeFileSync("site/data/judges.json", JSON.stringify(out));

// ---- Report --------------------------------------------------------------------------------------------------
const today = dayNum(new Date().toISOString().slice(0, 10));
const sitting = services.filter(s => s.start <= today && (s.end == null || s.end > today));
const active = sitting.filter(s => s.senior == null || s.senior > today);
const pct = (a, f) => Math.round(100 * a.filter(f).length / a.length) + "%";
const J = s => judges[s.j];
console.log(`judges ${judges.length}, services ${services.length}, sitting today ${new Set(sitting.map(s => s.j)).size} (active ${new Set(active.map(s => s.j)).size})`);
console.log(`active: women ${pct(active, s => J(s).gender === "F")}, Black ${pct(active, s => J(s).race.black)}, Hispanic ${pct(active, s => J(s).race.hispanic)}, Asian ${pct(active, s => J(s).race.asian)}, careers on record ${pct(active, s => J(s).careers.length)}, law school ${pct(active, s => J(s).lawSchool >= 0)}`);
console.log(`active careers: ${out.careers.map(c => `${c} ${pct(active, s => J(s).careers.includes(c))}`).join(", ")}`);
console.log(`state justices ${justices.length}: women ${pct(justices, j => j.gender === "F")}, gender known ${pct(justices, j => j.gender)}, Black ${pct(justices, j => j.race.black)}, Hispanic ${pct(justices, j => j.race.hispanic)}, Asian ${pct(justices, j => j.race.asian)}, Native ${pct(justices, j => j.race.native)}, LGBTQ ${pct(justices, j => j.race.lgbtq)}, appointed ${pct(justices, j => j.selection === "Appointed")}, party known ${pct(justices, j => j.party)}`);
console.log("top law schools (active federal):", Object.entries(active.reduce((m, s) => { const n = schoolList[J(s).lawSchool]; if (n) m[n] = (m[n] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x.join(" ")).join(", "));
if (lawSchoolShares) console.log("law grad shares:", ["Harvard", "Yale", "Stanford", "Chicago", "Columbia", "NYU", "Pennsylvania", "Virginia", "Michigan", "Duke", "Northwestern", "UC Berkeley", "Cornell", "Georgetown"].map(s => s + " " + ((lawSchoolShares[s] || 0) * 100).toFixed(2)).join(", "));
console.log("size:", Math.round(JSON.stringify(out).length / 1024), "KB");
