// Downloads the sources: node scripts/fetch.mjs
//   raw/fjc-*.csv           Federal Judicial Center, Biographical Directory of Article III Federal Judges (public domain)
//   data/state-justices.json  current justices of every state high court, from each court's Wikipedia article,
//                             with gender and education from Wikidata and race/ethnicity from Wikipedia categories
//   data/benchmarks.json    U.S. population, education and veterans (Census Bureau, BLS) and lawyers and judges (BLS); see benchmarks.mjs
// The files in data/ are committed. If a source can't be reached, the last good copy is kept and the build still works.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { population, education, veterans, occupations, lawSchools, BROWSER } from "./benchmarks.mjs";

const UA = "who-judges/1.0 (https://github.com/jc0h3n/who-judges; open-data build script)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync("raw", { recursive: true }); mkdirSync("data", { recursive: true });

async function get(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
    if (r.ok) return r;
    if (attempt >= 4 || (r.status !== 429 && r.status < 500)) throw new Error(`${r.status} ${r.statusText} for ${url.slice(0, 140)}`);
    await sleep(8000 * attempt);
  }
}
const readJSON = f => existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
async function step(name, fn) {
  try { await fn(); } catch (e) { console.warn(`! ${name} failed, keeping the last good copy: ${e.message}`); process.exitCode = 0; }
}

// ---- 1. Federal Judicial Center --------------------------------------------------------------
await step("FJC", async () => {
  for (const f of ["demographics", "education", "federal-judicial-service", "professional-career", "other-federal-judicial-service"]) {
    const r = await get(`https://www.fjc.gov/sites/default/files/history/${f}.csv`, BROWSER);
    writeFileSync(`raw/fjc-${f}.csv`, Buffer.from(await r.arrayBuffer()));
    console.log("saved FJC", f);
  }
});

// ---- 2. State high courts ----------------------------------------------------------------------
// [state, court, Wikipedia article]. Texas and Oklahoma have separate courts of last resort for criminal cases.
const COURTS = [
  ["AL", "Supreme Court of Alabama", "Supreme_Court_of_Alabama"], ["AK", "Alaska Supreme Court", "Alaska_Supreme_Court"],
  ["AZ", "Arizona Supreme Court", "Arizona_Supreme_Court"], ["AR", "Arkansas Supreme Court", "Arkansas_Supreme_Court"],
  ["CA", "Supreme Court of California", "Supreme_Court_of_California"], ["CO", "Colorado Supreme Court", "Colorado_Supreme_Court"],
  ["CT", "Connecticut Supreme Court", "Connecticut_Supreme_Court"], ["DE", "Delaware Supreme Court", "Delaware_Supreme_Court"],
  ["DC", "District of Columbia Court of Appeals", "District_of_Columbia_Court_of_Appeals"], ["FL", "Supreme Court of Florida", "Supreme_Court_of_Florida"],
  ["GA", "Supreme Court of Georgia", "Supreme_Court_of_Georgia_(U.S._state)"], ["HI", "Supreme Court of Hawaii", "Supreme_Court_of_Hawaii"],
  ["ID", "Idaho Supreme Court", "Idaho_Supreme_Court"], ["IL", "Supreme Court of Illinois", "Supreme_Court_of_Illinois"],
  ["IN", "Indiana Supreme Court", "Indiana_Supreme_Court"], ["IA", "Iowa Supreme Court", "Iowa_Supreme_Court"],
  ["KS", "Kansas Supreme Court", "Kansas_Supreme_Court"], ["KY", "Kentucky Supreme Court", "Kentucky_Supreme_Court"],
  ["LA", "Louisiana Supreme Court", "Louisiana_Supreme_Court"], ["ME", "Maine Supreme Judicial Court", "Maine_Supreme_Judicial_Court"],
  ["MD", "Supreme Court of Maryland", "Supreme_Court_of_Maryland"], ["MA", "Massachusetts Supreme Judicial Court", "Massachusetts_Supreme_Judicial_Court"],
  ["MI", "Michigan Supreme Court", "Michigan_Supreme_Court"], ["MN", "Minnesota Supreme Court", "Minnesota_Supreme_Court"],
  ["MS", "Supreme Court of Mississippi", "Supreme_Court_of_Mississippi"], ["MO", "Supreme Court of Missouri", "Supreme_Court_of_Missouri"],
  ["MT", "Montana Supreme Court", "Montana_Supreme_Court"], ["NE", "Nebraska Supreme Court", "Nebraska_Supreme_Court"],
  ["NV", "Supreme Court of Nevada", "Supreme_Court_of_Nevada"], ["NH", "New Hampshire Supreme Court", "New_Hampshire_Supreme_Court"],
  ["NJ", "Supreme Court of New Jersey", "Supreme_Court_of_New_Jersey"], ["NM", "New Mexico Supreme Court", "New_Mexico_Supreme_Court"],
  ["NY", "New York Court of Appeals", "New_York_Court_of_Appeals"], ["NC", "North Carolina Supreme Court", "North_Carolina_Supreme_Court"],
  ["ND", "North Dakota Supreme Court", "North_Dakota_Supreme_Court"], ["OH", "Supreme Court of Ohio", "Supreme_Court_of_Ohio"],
  ["OK", "Oklahoma Supreme Court", "Oklahoma_Supreme_Court"], ["OK", "Oklahoma Court of Criminal Appeals", "Oklahoma_Court_of_Criminal_Appeals"],
  ["OR", "Oregon Supreme Court", "Oregon_Supreme_Court"], ["PA", "Supreme Court of Pennsylvania", "Supreme_Court_of_Pennsylvania"],
  ["RI", "Rhode Island Supreme Court", "Rhode_Island_Supreme_Court"], ["SC", "South Carolina Supreme Court", "South_Carolina_Supreme_Court"],
  ["SD", "South Dakota Supreme Court", "South_Dakota_Supreme_Court"], ["TN", "Tennessee Supreme Court", "Tennessee_Supreme_Court"],
  ["TX", "Supreme Court of Texas", "Supreme_Court_of_Texas"], ["TX", "Texas Court of Criminal Appeals", "Texas_Court_of_Criminal_Appeals"],
  ["UT", "Utah Supreme Court", "Utah_Supreme_Court"], ["VT", "Vermont Supreme Court", "Vermont_Supreme_Court"],
  ["VA", "Supreme Court of Virginia", "Supreme_Court_of_Virginia"], ["WA", "Washington Supreme Court", "Washington_Supreme_Court"],
  ["WV", "Supreme Court of Appeals of West Virginia", "Supreme_Court_of_Appeals_of_West_Virginia"], ["WI", "Wisconsin Supreme Court", "Wisconsin_Supreme_Court"],
  ["WY", "Wyoming Supreme Court", "Wyoming_Supreme_Court"]
];

const text = s => s.replace(/<sup[\s\S]*?<\/sup>|<style[\s\S]*?<\/style>/g, "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
// Attributes can hold quoted ">" characters (Parsoid's data-mw), so tags are matched quote-aware.
const ATTRS = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;
const cellRe = new RegExp(String.raw`<(t[hd])\b${ATTRS}>([\s\S]*?)<\/t[hd]>`, "g");
const cellsOf = row => [...row.matchAll(cellRe)].map(m => ({ tag: m[1], attrs: m[2], html: m[3],
  rowspan: +(m[2].match(/\browspan="?(\d+)/) || [])[1] || 1, colspan: +(m[2].match(/\bcolspan="?(\d+)/) || [])[1] || 1 }));
// The party of a cell, from Wikipedia's party-shading templates (used for appointing governors and elected justices)
const partyOf = attrs => { const m = attrs.match(/Party[ _]shading\/([A-Za-z_ ]+)/); return m ? m[1].replace(/_/g, " ").trim() : null; };

// Lays table rows out on a grid, expanding rowspans and colspans, so every row has one cell per column.
function toGrid(rows) {
  const grid = [], carry = [];
  for (const row of rows) {
    const line = [];
    let col = 0;
    const fill = () => { while (carry[col]?.left > 0) { line[col] = carry[col].cell; carry[col].left--; col++; } };
    for (const c of cellsOf(row)) {
      fill();
      for (let k = 0; k < c.colspan; k++) { line[col] = c; if (c.rowspan > 1) carry[col] = { cell: c, left: c.rowspan - 1 }; col++; }
    }
    fill();
    grid.push(line);
  }
  return grid;
}

const NAME_COL = /^(name|justice|judge)$/;
const START_COL = /^(start|began|took office|since|joined|appointed|assumed office)$|active|^term of service/;
// Finds the table of sitting justices: the first wikitable whose header has a name column and a born or start
// column. Header rows (all <th>) can be stacked, as in "Term of service / Active". A full-width row that says
// "senior" or "former" ends the list of sitting justices.
function currentTable(html) {
  const tableRe = new RegExp(String.raw`<table\b${ATTRS}>([\s\S]*?)<\/table>`, "g");
  for (const t of html.matchAll(tableRe)) {
    if (!/wikitable/.test(t[1])) continue;
    const rows = [...t[2].matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
    let nHead = 0;
    while (nHead < rows.length && cellsOf(rows[nHead]).every(c => c.tag === "th") && cellsOf(rows[nHead]).length > 1) nHead++;
    if (!nHead) continue;
    const grid = toGrid(rows);
    const width = Math.max(...grid.slice(0, nHead).map(l => l.length));
    const head = Array.from({ length: width }, (_, i) =>
      [...new Set(grid.slice(0, nHead).map(l => l[i] ? text(l[i].html).toLowerCase() : ""))].filter(Boolean).join(" "));
    const nameCol = head.findIndex(h => NAME_COL.test(h));
    if (nameCol < 0 || !head.some(h => /^born/.test(h) || START_COL.test(h))) continue;
    const out = [];
    for (let r = nHead; r < grid.length; r++) {
      const line = grid[r], cells = [...new Set(line.filter(Boolean))];
      if (cells.length === 1) { if (/senior|former|retired|past/i.test(text(cells[0].html))) break; continue; }
      const nameCell = line[nameCol];
      if (!nameCell || cells.length < 3) continue;
      if (r > nHead && grid[r - 1][nameCol] === nameCell) continue;   // a row continued by rowspan, not a new justice
      const rec = {};
      head.forEach((h, i) => { if (line[i] && !(h in rec)) { rec[h] = text(line[i].html); rec["_party_" + h] = partyOf(line[i].attrs); } });
      const link = nameCell.html.match(/<a [^>]*href="\.\/([^"#?]+)"/) || nameCell.html.match(/<a [^>]*href="\/wiki\/([^"#?]+)"/);
      rec._link = link ? decodeURIComponent(link[1]) : null;
      const name = rec[head[nameCol]];
      if (!name || /^vacant|^\(vacant/i.test(name)) continue;
      // Senior (semi-retired) judges listed alongside active ones carry a year in a "senior" column
      if (head.some(h => /senior/.test(h) && /\b(19|20)\d\d\b/.test(rec[h] || ""))) continue;
      out.push(rec);
    }
    if (out.length) return { head, rows: out };
  }
  return null;
}

const pick = (rec, re) => { const k = Object.keys(rec).find(k => !k.startsWith("_") && re.test(k)); return k ? rec[k] : ""; };
const pickParty = (rec, re) => { const k = Object.keys(rec).find(k => !k.startsWith("_") && re.test(k)); return k ? rec["_party_" + k] : null; };
const year = s => { const m = (s || "").match(/\b(1[89]\d\d|20\d\d)\b/); return m ? +m[1] : null; };
// "—", "N/a" and "Elected" in an appointer column mean the justice was elected, not appointed.
const appointerOf = s => { const v = (s || "").replace(/^[—–-]\s*/, "").trim(); return !v || /^(n\/?a|none|elected|—|–|-)$/i.test(v) ? null : v; };

await step("state courts", async () => {
  const justices = [], problems = [];
  for (const [st, court, title] of COURTS) {
    await sleep(1500);
    let html;
    try { html = await (await get(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`)).text(); }
    catch (e) { problems.push(`${court}: ${e.message}`); continue; }
    const t = currentTable(html);
    if (!t) { problems.push(`${court}: no table of current justices found`); continue; }
    const seen = new Set();
    for (const r of t.rows) {
      const raw = pick(r, NAME_COL), title = pick(r, /^(position|seat|title)$/);
      const name = raw.replace(/\s*\((acting )?(chief|c\.j\.)[^)]*\)/i, "").replace(/,?\s*(acting )?chief (justice|judge)$/i, "")
        .replace(/^(Chief Justice|Chief Judge|Justice|Judge)\s+/i, "").replace(/\s*[*†‡]+$/, "").trim();
      const key = r._link || name;
      if (seen.has(key)) continue; seen.add(key);
      const appointer = appointerOf(pick(r, /^appoint(er|ed by|ing)/));
      justices.push({
        st, court, name, chief: /chief/i.test(raw + " " + title) && !/associate/i.test(title) || null,
        wiki: r._link,
        born: year(pick(r, /^born/)), start: year(pick(r, START_COL)),
        termEnds: year(pick(r, /term end|term expires|next election|retention|term of office ends/)) || null,
        party: pick(r, /^party/) || null, appointer,
        appointerParty: appointer ? pickParty(r, /^appoint/) : null, electedParty: pickParty(r, /^party/),
        lawSchool: pick(r, /law school|alma mater|education/) || null
      });
    }
    console.log(`${court}: ${seen.size}`);
  }
  if (justices.length < 250) throw new Error(`only ${justices.length} justices parsed; problems: ${problems.join("; ")}`);

  // Wikidata items for the justices' articles, then gender, birth date and schools
  const titles = [...new Set(justices.map(j => j.wiki).filter(Boolean))];
  const qid = {}, cats = {};
  for (let i = 0; i < titles.length; i += 50) {
    await sleep(1000);
    const batch = titles.slice(i, i + 50);
    let cont = {};
    do {
      const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", prop: "pageprops|categories",
        ppprop: "wikibase_item", clshow: "!hidden", cllimit: "max", titles: batch.join("|"), ...cont });
      const j = await (await get(`https://en.wikipedia.org/w/api.php?${params}`)).json();
      const alias = Object.fromEntries([...(j.query.normalized || []), ...(j.query.redirects || [])].map(x => [x.to, x.from]));
      for (const p of j.query.pages || []) {
        let key = p.title; while (alias[key]) key = alias[key];
        const t = key.replace(/ /g, "_");
        if (p.pageprops?.wikibase_item) qid[t] = p.pageprops.wikibase_item;
        (cats[t] ||= []).push(...(p.categories || []).map(c => c.title.replace(/^Category:/, "")));
      }
      cont = j.continue || null;
    } while (cont);
  }
  const ids = [...new Set(Object.values(qid))];
  const wd = {};
  for (let i = 0; i < ids.length; i += 150) {
    await sleep(1000);
    const q = `SELECT ?p ?sexLabel ?birth ?schoolLabel ?degreeLabel WHERE { VALUES ?p { ${ids.slice(i, i + 150).map(x => "wd:" + x).join(" ")} }
      OPTIONAL { ?p wdt:P21 ?sex } OPTIONAL { ?p wdt:P569 ?birth }
      OPTIONAL { ?p p:P69 ?e . ?e ps:P69 ?school . OPTIONAL { ?e pq:P512 ?degree } }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    const j = await (await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { Accept: "application/sparql-results+json" })).json();
    for (const b of j.results.bindings) {
      const id = b.p.value.split("/").pop(), w = (wd[id] ||= { sex: null, born: null, schools: [] });
      if (b.sexLabel) w.sex = b.sexLabel.value;
      if (b.birth && !w.born) w.born = +b.birth.value.slice(0, 4);
      if (b.schoolLabel && !/^Q\d+$/.test(b.schoolLabel.value)) w.schools.push({ school: b.schoolLabel.value, degree: b.degreeLabel?.value || null });
    }
  }
  for (const j of justices) {
    const id = j.wiki && qid[j.wiki], w = id && wd[id];
    j.wikidata = id || null;
    j.sex = w?.sex === "female" ? "F" : w?.sex === "male" ? "M" : null;
    if (!j.born && w?.born) j.born = w.born;
    j.schools = w ? [...new Map(w.schools.map(s => [s.school + "|" + s.degree, s])).values()] : [];
    j.categories = (j.wiki && cats[j.wiki]) || [];
  }
  const old = readJSON("data/state-justices.json");
  // A weekly record of each state court's makeup, so changes on state benches can be traced over time
  // (no other open source keeps one). Counts only; one entry per court per fetch date.
  const today = new Date().toISOString().slice(0, 10);
  const history = (readJSON("data/state-history.json") || []).filter(h => h.date !== today);
  const byCourt = {};
  for (const j of justices) {
    const c = (byCourt[j.court] ||= { st: j.st, n: 0, women: 0, known: 0, appointed: 0 });
    c.n++; if (j.sex) c.known++; if (j.sex === "F") c.women++; if (j.appointer) c.appointed++;
  }
  // Who joined or left since the last check (by Wikipedia article, or name when there is none)
  const key = j => j.court + "|" + (j.wiki || j.name);
  const before = new Map((old?.justices || []).map(j => [key(j), j])), after = new Map(justices.map(j => [key(j), j]));
  const joined = old ? justices.filter(j => !before.has(key(j))).map(j => ({ court: j.court, st: j.st, name: j.name })) : [];
  const left = old ? old.justices.filter(j => !after.has(key(j))).map(j => ({ court: j.court, st: j.st, name: j.name })) : [];
  history.push({ date: today, since: old?.fetched || null, courts: byCourt, joined, left });
  writeFileSync("data/state-history.json", JSON.stringify(history) + "\n");
  writeFileSync("data/state-justices.json", JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), problems, justices }, null, 1) + "\n");
  console.log(`state justices: ${justices.length} (was ${old?.justices?.length ?? 0}); problems: ${problems.length ? problems.join("; ") : "none"}`);
});

// ---- 3. Benchmarks -----------------------------------------------------------------------------
const bench = readJSON("data/benchmarks.json") || {};
await step("Census population", async () => { bench.population = await population(); console.log("Census", bench.population.year); });
await step("Census education", async () => { bench.education = await education(); console.log("education", bench.education.year); });
await step("BLS veterans", async () => { bench.veterans = await veterans(); console.log("veterans", bench.veterans.year); });
await step("ABA law schools", async () => { bench.lawSchools = await lawSchools(); console.log("ABA law schools", bench.lawSchools.years.at(-1)); });
await step("BLS occupations", async () => {
  bench.bls = await occupations({ workforce: "Total, 16 years and over", lawyers: "Lawyers", judges: "Judges, magistrates, and other judicial workers" });
  console.log("BLS", bench.bls.year);
});

bench.fetched = new Date().toISOString().slice(0, 10);
writeFileSync("data/benchmarks.json", JSON.stringify(bench, null, 1) + "\n");
