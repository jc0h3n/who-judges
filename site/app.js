import { hbars, stackedHbars, columns, lines, legend, fmtPct, fmtInt } from "./charts.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const share = (arr, f) => arr.length ? arr.filter(f).length / arr.length : 0;
const count = arr => Object.entries(arr.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]);
const DAY = 864e5;
const toDay = iso => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
const isoOf = day => new Date(day * DAY).toISOString().slice(0, 10);
const yearOf = day => new Date(day * DAY).getUTCFullYear();
const longDate = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const PARTY = {
  Democratic: { label: "Democratic", color: "var(--p-dem)" },
  Republican: { label: "Republican", color: "var(--p-rep)" },
  other: { label: "Other or none", color: "var(--p-other)" }
};
const partyKey = p => p === "Democratic" || p === "Republican" ? p : "other";
const partySegments = (rows, partyOf = r => r.party) => Object.keys(PARTY).map(k => ({ key: PARTY[k].label, value: rows.filter(r => partyKey(partyOf(r)) === k).length, color: PARTY[k].color }));
const partyKeys = (rows, partyOf = r => r.party) => Object.keys(PARTY).filter(k => rows.some(r => partyKey(partyOf(r)) === k)).map(k => PARTY[k]);

const TABS = [["federal", "Federal courts"], ["trends", "Over time"], ["state", "State supreme courts"], ["compare", "Compared with the country"], ["members", "Judges"], ["about", "About the data"]];
const CIRCUITS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "District of Columbia", "Federal"];
const BITS = { black: 1, hispanic: 2, asian: 4, native: 8, pacific: 16, mena: 32 };

let D, J, S, ST, TODAY;
const DEFAULTS = () => ({ tab: "federal", level: "all", date: isoOf(TODAY), status: "active", party: "all", circuit: "all", gender: "all", st: "all", selection: "all", sparty: "all", q: "", sort: "name", dir: 1, bench: "federal" });
let state;

// ---- Data ---------------------------------------------------------------------------------------------------
function decode(raw) {
  J = raw.judges.map((j, i) => ({
    i, name: j[0], last: j[1], gender: j[2], born: j[3], died: j[4], race: raw.races[j[5]], bits: j[6],
    black: !!(j[6] & 1), hispanic: !!(j[6] & 2), asian: !!(j[6] & 4), native: !!(j[6] & 8), pacific: !!(j[6] & 16),
    lawSchool: j[7] >= 0 ? raw.schools[j[7]] : null, schools: j[8].map(k => raw.schools[k]), ivy: j[8].some(k => raw.ivy[k]),
    careers: j[9].map(k => raw.careers[k]), raceLabel: j[10]
  }));
  S = raw.services.map(s => ({
    j: J[s[0]], court: raw.courts[s[1]], type: s[2], st: s[3], circuit: s[4], pres: s[5] >= 0 ? raw.presidents[s[5]] : null, party: s[6],
    aba: s[7] >= 0 ? raw.aba[s[7]] : null, nominated: s[8], confirmed: s[9], start: s[10], senior: s[11], end: s[12], ayes: s[13], nays: s[14], voice: !!s[15], title: s[16]
  }));
  ST = raw.justices.map(j => ({ ...j, black: j.race.black, hispanic: j.race.hispanic, asian: j.race.asian, native: j.race.native, lgbtq: j.race.lgbtq }));
}

// Who was on the federal bench on a given day: one row per judge (their current seat).
function sittingOn(day, { level = state.level, status = state.status, party = state.party, circuit = "all", gender = state.gender } = {}) {
  const seen = new Map();
  for (const s of S) {
    if (s.start > day || (s.end != null && s.end <= day)) continue;
    if (status === "active" && s.senior != null && s.senior <= day) continue;
    if (level !== "all" && s.type !== level) continue;
    if (party !== "all" && s.party !== party) continue;
    if (circuit !== "all" && s.circuit !== circuit) continue;
    if (gender !== "all" && s.j.gender !== gender) continue;
    const prev = seen.get(s.j.i);
    if (!prev || s.start > prev.start) seen.set(s.j.i, s);
  }
  return [...seen.values()];
}
const ageOn = (s, day) => s.j.born ? yearOf(day) - s.j.born : null;
const isSenior = (s, day) => s.senior != null && s.senior <= day;
const nonWhite = j => j.race !== "White" && j.race !== "Not reported" && j.race !== "White or not recorded";

// ---- URL state -----------------------------------------------------------------------------------------------
const KEYS = ["tab", "level", "date", "status", "party", "circuit", "gender", "st", "selection", "sparty", "bench"];
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const k of KEYS) if (h.get(k)) state[k] = h.get(k);
  if (!TABS.some(([k]) => k === state.tab)) state.tab = "federal";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.date) || toDay(state.date) > TODAY) state.date = isoOf(TODAY);
}
function writeHash() {
  const d = DEFAULTS(), h = new URLSearchParams({ tab: state.tab });
  for (const k of KEYS.slice(1)) if (state[k] !== d[k]) h.set(k, state[k]);
  history.replaceState(null, "", "#" + h);
}

// ---- Controls --------------------------------------------------------------------------------------------------
function renderControls() {
  $("tabs").innerHTML = TABS.map(([k, label]) => `<button class="link${state.tab === k ? " on" : ""}" data-tab="${k}">${label}</button>`).join(' <span>/</span> ');
  const tab = state.tab === "members" && state.bench === "state" ? "state" : state.tab;
  for (const l of $("filters").querySelectorAll("label[data-for]")) l.hidden = !l.dataset.for.split(" ").includes(tab);
  $("filters").hidden = ["compare", "about"].includes(state.tab);
  if (!$("f-circuit").options.length) $("f-circuit").innerHTML = `<option value="all">All circuits</option>` + CIRCUITS.map(c => `<option value="${c}">${c === "District of Columbia" ? "D.C." : c} Circuit</option>`).join("");
  if (!$("f-state").options.length) $("f-state").innerHTML = `<option value="all">All states</option>` + [...new Set(ST.map(j => j.st))].sort().map(s => `<option>${s}</option>`).join("");
  $("f-date").max = isoOf(TODAY);
  for (const [id, k] of [["f-level", "level"], ["f-date", "date"], ["f-status", "status"], ["f-party", "party"], ["f-circuit", "circuit"], ["f-gender", "gender"], ["f-state", "st"], ["f-selection", "selection"], ["f-sparty", "sparty"]]) $(id).value = state[k];
}

// ---- Shared pieces ----------------------------------------------------------------------------------------------
const tile = (label, value, sub = "") => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
const chart = (id, title, note = "", wide = false) => `<section class="chart${wide ? " wide" : ""}"><h2>${title}</h2>${note ? `<p class="note">${note}</p>` : ""}<div class="body" id="${id}"></div></section>`;
function barsFromCounts(el, values, denom, { top = 12, noun = "judges" } = {}) {
  if (!denom) { el.innerHTML = `<p class="muted">No data for this selection.</p>`; return; }
  hbars(el, count(values).slice(0, top).map(([label, n]) => ({ label, value: n / denom, n })),
    { tipText: i => `<b>${esc(i.label)}</b><br>${i.n} of ${denom} ${noun} (${fmtPct(i.value)})` });
}
// Side-by-side bars: a group of judges against all U.S. adults (Census population estimates, BLS, CPS education)
function usAdults() {
  const B = D.benchmarks, p = B.population?.adults, bands = B.population?.adultAgeBands || {};
  return p && { women: p.women, color: 1 - p.whiteNH, black: p.blackAny, hispanic: p.hispanic, asian: p.asianAny, native: p.nativeAny,
    over65: Object.entries(bands).filter(([b]) => +b >= 65).reduce((t, [, v]) => t + v, 0), under40: Object.entries(bands).filter(([b]) => +b < 40).reduce((t, [, v]) => t + v, 0),
    graduate: B.education?.graduate, veterans: B.veterans?.adultsShare, medianAge: B.population.adultMedianAge, year: B.population.year };
}
function vsCountry(el, groupLabel, metrics) {
  const us = usAdults();
  if (!us) { el.innerHTML = `<p class="muted">Population figures unavailable.</p>`; return; }
  const items = metrics.filter(m => m.us != null && m.value != null).flatMap(m => [
    { label: `${m.label}: ${groupLabel}`, value: m.value, cls: "hl", note: m.note },
    { label: `${m.label}: U.S. adults`, value: m.us, cls: "ref pair-end", note: m.usNote }
  ]);
  hbars(el, items, { max: 1, tipText: i => `<b>${esc(i.label)}</b><br>${fmtPct(i.value)}${i.note ? `<br>${esc(i.note)}` : ""}` });
}
const vsNote = () => { const B = D.benchmarks; return `U.S. adults: Census Bureau population estimates (${B.population?.year}, ages 18 and over), Census CPS educational attainment (${B.education?.year}, ages 25 and over), BLS veteran population (${B.veterans?.year}). Black and Asian Americans include people who report more than one race, matching how judges who report more than one race are counted.`; };

const LEVEL_NAME = { all: "federal judges", "Supreme Court": "Supreme Court justices", "Courts of appeals": "appeals court judges", "District courts": "district judges", "Other Article III courts": "judges on the other Article III courts" };

// ---- Federal view -------------------------------------------------------------------------------------------------
function federal() {
  const day = toDay(state.date);
  const sel = sittingOn(day, { circuit: state.circuit });
  const js = sel.map(s => s.j);
  const isToday = day === TODAY;
  const what = `${state.status === "active" ? "active " : ""}${LEVEL_NAME[state.level]}${state.circuit !== "all" ? ` in the ${state.circuit === "District of Columbia" ? "D.C." : state.circuit} Circuit` : ""}${state.party !== "all" ? `, appointed by ${state.party} presidents` : ""}${state.gender !== "all" ? `, ${state.gender === "F" ? "women" : "men"} only` : ""}`;
  if (!sel.length) { $("view").innerHTML = `<p class="summary">No ${what} were sitting on ${longDate(state.date)}.</p>`; return; }
  const ages = sel.map(s => ageOn(s, day)).filter(a => a != null);
  const senior = sel.filter(s => isSenior(s, day)).length;
  const raceKnown = js.filter(j => j.race !== "Not reported");
  const US = usAdults() || {};
  $("view").innerHTML = `
    <p class="summary"><b>${fmtInt(sel.length)} ${what}</b> ${isToday ? "are sitting today" : `were sitting on ${longDate(state.date)}`}${state.status === "all" ? `, ${fmtInt(senior)} of them on senior status` : ""}.
      ${fmtInt(sel.filter(s => s.party === "Democratic").length)} were appointed by Democratic presidents and ${fmtInt(sel.filter(s => s.party === "Republican").length)} by Republicans.</p>
    <div class="tiles">
      ${tile("Women", fmtPct(share(js, j => j.gender === "F")), `${fmtInt(js.filter(j => j.gender === "F").length)} judges · ${fmtPct(US.women)} of U.S. adults`)}
      ${tile("People of color", fmtPct(share(raceKnown, nonWhite)), `${fmtPct(US.color)} of U.S. adults`)}
      ${tile("Median age", ages.length ? Math.round(median(ages)) : "–", `${isToday ? "today" : "on that date"} · U.S. adults ${US.medianAge}`)}
      ${tile("Former prosecutors", fmtPct(share(js, j => j.careers.some(c => /prosecutor/.test(c)))), "federal, state or local")}
      ${tile("Former public defenders", fmtPct(share(js, j => j.careers.includes("Public defender"))), "or legal aid")}
      ${tile("Harvard or Yale law", fmtPct(share(js, j => j.lawSchool === "Harvard" || j.lawSchool === "Yale")), "first law degree")}
    </div>
    <h2 class="section-title">Compared with the country</h2>
    <div class="grid2">${chart("c-vs", "These judges and all U.S. adults", vsNote(), true)}</div>
    <h2 class="section-title">Who they are</h2>
    <div class="grid2">
      ${chart("c-race", "Race and ethnicity", "As reported to the Federal Judicial Center. Hispanic judges of any race are counted as Hispanic.")}
      ${chart("c-gender", "Women, by appointing party", "Share of each party's appointees who are women.")}
      ${chart("c-age", "Age", `Judges per five-year age band ${isToday ? "today" : "on that date"}.`)}
      ${chart("c-raceparty", "People of color, by appointing party", "Share of each party's appointees who are not white.")}
    </div>
    <h2 class="section-title">The road to the bench</h2>
    <div class="grid2">
      ${chart("c-careers", "Careers before the bench", "Share of judges who held each kind of job before their appointment. Most held several.")}
      ${chart("c-pipeline", "Prosecutors and defenders, by appointing party", "Former prosecutors (federal, state or local) and former public defenders, as a share of each party's appointees.")}
      ${chart("c-schools", "Law schools", "Where judges earned their first law degree, by appointing party.")}
      ${chart("c-ivy", "Elite schooling", "Share who attended each kind of school at any level.")}
    </div>
    <h2 class="section-title">How they got there</h2>
    <div class="grid2">
      ${chart("c-pres", "Appointing president", "Judges sitting on the date chosen, by the president who appointed them to their current seat.")}
      ${chart("c-aba", "American Bar Association rating", "The ABA's rating at nomination. Recent administrations stopped asking the ABA before nominating, so many recent judges have no rating.")}
    </div>`;
  vsCountry($("c-vs"), "judges", [
    { label: "Women", value: share(js, j => j.gender === "F"), us: US.women },
    { label: "People of color", value: share(raceKnown, nonWhite), us: US.color },
    { label: "Black", value: share(raceKnown, j => j.black), us: US.black },
    { label: "Hispanic or Latino", value: share(raceKnown, j => j.hispanic), us: US.hispanic },
    { label: "Asian American", value: share(raceKnown, j => j.asian), us: US.asian },
    { label: "Age 65 or older", value: share(ages, a => a >= 65), us: US.over65 },
    { label: "Under 40", value: share(ages, a => a < 40), us: US.under40 },
    { label: "Graduate or professional degree", value: share(js, j => j.lawSchool), us: US.graduate, note: "Every federal judge in the data has a law degree.", usNote: "Adults 25 and over with a master's, professional or doctoral degree." },
    { label: "Military service", value: share(js, j => j.careers.includes("Military")), us: US.veterans, note: "Military service listed in the judge's career (a lower bound).", usNote: "Veterans as a share of adults 18 and over." }
  ]);
  barsFromCounts($("c-race"), raceKnown.map(j => j.race), raceKnown.length);
  const parties = ["Democratic", "Republican"].filter(p => sel.some(s => s.party === p));
  hbars($("c-gender"), parties.map(p => { const rows = sel.filter(s => s.party === p); return { label: `${p} appointees`, value: share(rows, s => s.j.gender === "F"), n: rows.length, w: rows.filter(s => s.j.gender === "F").length }; }),
    { max: 1, tipText: i => `<b>${esc(i.label)}</b><br>${i.w} of ${i.n} are women (${fmtPct(i.value)})` });
  hbars($("c-raceparty"), parties.map(p => { const rows = sel.filter(s => s.party === p && s.j.race !== "Not reported"); return { label: `${p} appointees`, value: share(rows, s => nonWhite(s.j)), n: rows.length, w: rows.filter(s => nonWhite(s.j)).length }; }),
    { max: 1, tipText: i => `<b>${esc(i.label)}</b><br>${i.w} of ${i.n} are people of color (${fmtPct(i.value)})` });
  const bands = []; for (let a = 35; a <= 95; a += 5) bands.push({ lo: a === 35 ? 0 : a, hi: a === 95 ? 200 : a + 4 });
  columns($("c-age"), bands.map(b => { const n = ages.filter(a => a >= b.lo && a <= b.hi).length; const label = b.lo === 0 ? "<40" : b.hi === 200 ? "95+" : `${b.lo}`;
    return { label, value: n, tip: `<b>Age ${b.lo === 0 ? "under 40" : b.hi === 200 ? "95 and over" : `${b.lo}–${b.hi}`}</b><br>${n} judges` }; }), { labelEvery: 2 });
  const withCareer = js.filter(j => j.careers.length);
  barsFromCounts($("c-careers"), withCareer.flatMap(j => j.careers), withCareer.length);
  const pipe = [["Former prosecutors", j => j.careers.some(c => /prosecutor/.test(c))], ["Former public defenders", j => j.careers.includes("Public defender")]];
  $("c-pipeline").innerHTML = legend(parties.map(p => PARTY[p])) + `<div id="c-pipe2"></div>`;
  hbars($("c-pipe2"), pipe.flatMap(([label, f]) => parties.map(p => { const rows = sel.filter(s => s.party === p); return { label: `${label}, ${p === "Democratic" ? "D" : "R"}`, value: share(rows, s => f(s.j)), n: rows.length, w: rows.filter(s => f(s.j)).length, cls: p === "Democratic" ? "dem" : "rep" }; })),
    { tipText: i => `<b>${esc(i.label)}</b><br>${i.w} of ${i.n} appointees (${fmtPct(i.value)})` });
  const schools = count(sel.map(s => s.j.lawSchool).filter(Boolean)).slice(0, 15);
  stackedHbars($("c-schools"), schools.map(([sch]) => ({ label: sch, segments: partySegments(sel.filter(s => s.j.lawSchool === sch)) })), partyKeys(sel));
  hbars($("c-ivy"), [
    ["Harvard or Yale law school", j => j.lawSchool === "Harvard" || j.lawSchool === "Yale"],
    ["Any Ivy League school", j => j.ivy],
    ["A top-14 law school", j => T14.has(j.lawSchool)]
  ].map(([label, f]) => ({ label, value: share(js, f), n: js.filter(f).length })), { max: 1, tipText: i => `<b>${esc(i.label)}</b><br>${i.n} of ${js.length} judges (${fmtPct(i.value)})` });
  const pres = count(sel.map(s => s.pres || "Unknown"));
  stackedHbars($("c-pres"), pres.slice(0, 12).map(([p]) => ({ label: p, segments: partySegments(sel.filter(s => (s.pres || "Unknown") === p)) })), partyKeys(sel));
  const withAba = sel.filter(s => s.aba);
  hbars($("c-aba"), [...D.aba, "No rating"].map(r => { const n = r === "No rating" ? sel.length - withAba.length : withAba.filter(s => s.aba === r).length; return { label: r, value: n / sel.length, n }; }),
    { tipText: i => `<b>${esc(i.label)}</b><br>${i.n} of ${sel.length} judges (${fmtPct(i.value)})` });
}
// The 14 law schools that have long led U.S. News rankings (a common, if rough, measure of elite legal education)
const T14 = new Set(["Yale", "Stanford", "Harvard", "Chicago", "Columbia", "NYU", "Pennsylvania", "Virginia", "Michigan", "Duke", "Northwestern", "UC Berkeley", "Cornell", "Georgetown"]);

// ---- Over time ------------------------------------------------------------------------------------------------------
function trends() {
  const first = 1790, last = yearOf(TODAY);
  const years = []; for (let y = first; y <= last; y++) years.push(y);
  const snap = years.map(y => { const day = y === last ? TODAY : toDay(`${y}-07-01`); return { y, day, sel: sittingOn(day, { circuit: "all" }) }; });
  const series = (f, { from = first, minN = 5 } = {}) => snap.filter(s => s.y >= from && s.sel.length >= minN).map(s => ({ x: s.y, y: f(s.sel, s.day), n: s.sel.length })).filter(p => p.y != null);
  const ink = "var(--bar)", opts = { marker: yearOf(toDay(state.date)), step: 1 };
  const desc = `${state.status === "active" ? "active " : ""}${LEVEL_NAME[state.level]}${state.party !== "all" ? ` appointed by ${state.party} presidents` : ""}${state.gender !== "all" ? `, ${state.gender === "F" ? "women" : "men"} only` : ""}`;
  $("view").innerHTML = `<p class="summary">The ${desc} sitting on July 1 of each year since ${first}. Hover a chart to read any year.</p>
    <div class="grid2">
      ${state.gender === "all" ? chart("t-women", "Women", "Share of judges who are women. The first woman on an Article III court, Florence Allen, joined the Sixth Circuit in 1934.") : ""}
      ${chart("t-color", "People of color", "Share of judges who are not white, as reported to the FJC.")}
      ${chart("t-race", "Black, Hispanic and Asian American judges", "Share of judges in each group. Multiracial judges count in each group they report.", true)}
      ${chart("t-age", "Median age", "Of judges sitting on July 1.")}
      ${chart("t-count", "Judges sitting", "Number of judges on the bench.")}
      ${chart("t-pipe", "Former prosecutors and public defenders", "Share of sitting judges with each job in their past.", true)}
      ${chart("t-elite", "Harvard and Yale", "Share whose first law degree is from Harvard or Yale.")}
      ${chart("t-party", "Appointed by Democratic presidents", "Share of sitting judges appointed by a Democrat (of those appointed by either party).")}
    </div>`;
  if (state.gender === "all") lines($("t-women"), [{ label: "Women", color: ink, points: series(sel => share(sel, s => s.j.gender === "F"), { from: 1930 }) }], { ...opts, yMin: 0 });
  lines($("t-color"), [{ label: "People of color", color: ink, points: series(sel => share(sel.filter(s => s.j.race !== "Not reported"), s => nonWhite(s.j)), { from: 1930 }) }], { ...opts, yMin: 0 });
  lines($("t-race"), [
    { label: "Black", color: "var(--p-dem)", points: series(sel => share(sel, s => s.j.black), { from: 1940 }) },
    { label: "Hispanic", color: "var(--p-whig)", points: series(sel => share(sel, s => s.j.hispanic), { from: 1940 }) },
    { label: "Asian American", color: "var(--p-other)", points: series(sel => share(sel, s => s.j.asian), { from: 1940 }) }
  ], { ...opts, yMin: 0, height: 240 });
  lines($("t-age"), [{ label: "Median age", color: ink, points: series((sel, day) => median(sel.map(s => ageOn(s, day)).filter(a => a != null))) }], { ...opts, yFormat: v => Math.round(v) });
  lines($("t-count"), [{ label: "Judges", color: ink, points: series(sel => sel.length, { minN: 1 }) }], { ...opts, yMin: 0, yFormat: v => fmtInt(v) });
  lines($("t-pipe"), [
    { label: "Former prosecutors", color: "var(--p-rep)", points: series(sel => share(sel, s => s.j.careers.some(c => /prosecutor/.test(c))), { from: 1900 }) },
    { label: "Former public defenders", color: "var(--p-dem)", points: series(sel => share(sel, s => s.j.careers.includes("Public defender")), { from: 1900 }) }
  ], { ...opts, yMin: 0, height: 240 });
  lines($("t-elite"), [{ label: "Harvard or Yale", color: ink, points: series(sel => share(sel, s => s.j.lawSchool === "Harvard" || s.j.lawSchool === "Yale"), { from: 1900 }) }], { ...opts, yMin: 0 });
  lines($("t-party"), [{ label: "Democratic appointees", color: ink, points: series(sel => { const p = sel.filter(s => /^(Democratic|Republican)$/.test(s.party)); return p.length ? share(p, s => s.party === "Democratic") : null; }, { from: 1860 }) }], { ...opts, yMin: 0, yMax: 1 });
}

// ---- State supreme courts ----------------------------------------------------------------------------------------------
function stateSel() {
  return ST.filter(j => (state.st === "all" || j.st === state.st) && (state.selection === "all" || j.selection === state.selection) &&
    (state.gender === "all" || j.gender === state.gender) && (state.sparty === "all" || (state.sparty === "none" ? !j.party : j.party === state.sparty)));
}
function stateView() {
  const sel = stateSel(), day = TODAY;
  const ages = sel.filter(j => j.born).map(j => yearOf(day) - j.born);
  const courts = new Set(sel.map(j => j.court)).size;
  const US = usAdults() || {};
  $("view").innerHTML = `
    <p class="summary"><b>${fmtInt(sel.length)} justices</b> sit on ${courts} state court${courts === 1 ? "" : "s"} of last resort${state.st !== "all" ? ` in ${state.st}` : " (every state, D.C., and the separate criminal appeals courts of Texas and Oklahoma)"}, as listed on Wikipedia on ${longDate(D.stateFetched)}.</p>
    <p class="caveat">State courts have no official national roster. Justices come from each court's Wikipedia article and are checked every week; gender and birth year come from Wikidata. Race and ethnicity come from the categories on each justice's Wikipedia article, which are incomplete, so the shares of Black, Hispanic, Asian American and Native American justices are lower bounds and everyone else is counted as “white or not recorded.”</p>
    <div class="tiles">
      ${tile("Women", fmtPct(share(sel.filter(j => j.gender), j => j.gender === "F")), `${fmtInt(sel.filter(j => j.gender === "F").length)} justices · ${fmtPct(US.women)} of U.S. adults`)}
      ${tile("People of color", fmtPct(share(sel, j => j.race.group !== "White or not recorded")), `on record (a lower bound) · ${fmtPct(US.color)} of U.S. adults`)}
      ${tile("Median age", ages.length ? Math.round(median(ages)) : "–", `today · U.S. adults ${US.medianAge}`)}
      ${tile("Appointed first", fmtPct(share(sel, j => j.selection === "Appointed")), "by a governor (or the president, for D.C.)")}
      ${tile("Elected first", fmtPct(share(sel, j => j.selection === "Elected")), "won a seat at the ballot box")}
    </div>
    <div class="grid2">${chart("s-vs", "These justices and all U.S. adults", vsNote() + " Justices' race is from Wikipedia categories, so their shares are lower bounds.", true)}</div>
    <div class="grid2">
      ${chart("s-race", "Race and ethnicity on record", "From Wikipedia categories; a lower bound for each group.")}
      ${chart("s-gender", "Women, by state", "Share of each state's high-court justices who are women. Hover for counts.", false)}
      ${chart("s-party", "Party", "For justices elected in partisan races, their own party; for appointed justices, the appointing governor's party. Nonpartisan elections leave no party on record.")}
      ${chart("s-age", "Age", "Justices per five-year age band today.")}
      ${chart("s-schools", "Law schools", "Where justices earned their law degree, by party as above.")}
      ${chart("s-states", "Justices of color, by state", "Share of each state's justices who are people of color on record. States with none on record are left out.", false)}
    </div>
    <h2 class="section-title">Recent changes</h2>
    <div id="s-changes"></div>
    <h2 class="section-title">Every justice</h2>
    <div class="table-tools"><input type="search" id="q" placeholder="Search names, states or schools…" value="${esc(state.q)}" aria-label="Search justices"><span class="muted" id="n-shown"></span><button class="link" id="csv-state">Download CSV</button></div>
    <div class="table-wrap" id="s-table"></div>`;
  vsCountry($("s-vs"), "justices", [
    { label: "Women", value: share(sel.filter(j => j.gender), j => j.gender === "F"), us: US.women },
    { label: "People of color", value: share(sel, j => j.race.group !== "White or not recorded"), us: US.color, note: "On record; a lower bound." },
    { label: "Black", value: share(sel, j => j.black), us: US.black },
    { label: "Hispanic or Latino", value: share(sel, j => j.hispanic), us: US.hispanic },
    { label: "Asian American", value: share(sel, j => j.asian), us: US.asian },
    { label: "Age 65 or older", value: share(ages, a => a >= 65), us: US.over65 },
    { label: "Under 40", value: share(ages, a => a < 40), us: US.under40 }
  ]);
  const raceRows = sel.filter(j => j.race.group !== "White or not recorded");
  hbars($("s-race"), [["Black", j => j.black], ["Hispanic", j => j.hispanic], ["Asian American", j => j.asian], ["Native American or Pacific Islander", j => j.native || j.race.pacific], ["LGBTQ (on record)", j => j.lgbtq]]
    .map(([label, f]) => ({ label, value: share(sel, f), n: sel.filter(f).length })), { tipText: i => `<b>${esc(i.label)}</b><br>${i.n} of ${sel.length} justices (${fmtPct(i.value)})` });
  void raceRows;
  const byState = count(sel.map(j => j.st)).map(([st]) => st).sort();
  const stateRows = byState.map(st => { const r = sel.filter(j => j.st === st && j.gender); return { label: st, value: share(r, j => j.gender === "F"), n: r.length, w: r.filter(j => j.gender === "F").length }; })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  hbars($("s-gender"), stateRows, { max: 1, tipText: i => `<b>${esc(i.label)}</b><br>${i.w} of ${i.n} justices are women (${fmtPct(i.value)})` });
  barsFromCounts($("s-party"), sel.map(j => j.party ? `${j.party} (${j.partyBasis === "elected" ? "elected as" : "appointed by"})` : "None recorded"), sel.length, { noun: "justices" });
  const bands = []; for (let a = 35; a <= 80; a += 5) bands.push({ lo: a === 35 ? 0 : a, hi: a === 80 ? 200 : a + 4 });
  columns($("s-age"), bands.map(b => { const n = ages.filter(a => a >= b.lo && a <= b.hi).length; return { label: b.lo === 0 ? "<40" : b.hi === 200 ? "80+" : `${b.lo}`, value: n, tip: `<b>Age ${b.lo === 0 ? "under 40" : b.hi === 200 ? "80 and over" : `${b.lo}–${b.hi}`}</b><br>${n} justices` }; }), { labelEvery: 2 });
  const schools = count(sel.map(j => j.lawSchool).filter(Boolean)).slice(0, 15);
  stackedHbars($("s-schools"), schools.map(([sch]) => ({ label: sch, segments: partySegments(sel.filter(j => j.lawSchool === sch)) })), partyKeys(sel), "justices");
  const diverse = byState.map(st => { const r = sel.filter(j => j.st === st); return { label: st, value: share(r, j => j.race.group !== "White or not recorded"), n: r.length, w: r.filter(j => j.race.group !== "White or not recorded").length }; })
    .filter(r => r.w).sort((a, b) => b.value - a.value).slice(0, 20);
  if (diverse.length) hbars($("s-states"), diverse, { max: 1, tipText: i => `<b>${esc(i.label)}</b><br>${i.w} of ${i.n} justices are people of color on record (${fmtPct(i.value)})` });
  else $("s-states").innerHTML = `<p class="muted">No justices of color on record for this selection.</p>`;
  const changes = (D.stateChanges || []).slice().reverse().map(c => ({ ...c, joined: c.joined.filter(x => state.st === "all" || x.st === state.st), left: c.left.filter(x => state.st === "all" || x.st === state.st) })).filter(c => c.joined.length || c.left.length);
  $("s-changes").innerHTML = changes.length ? `<ul class="sources">${changes.slice(0, 20).map(c => `<li><b>${longDate(c.date)}</b>${c.since ? ` (since ${longDate(c.since)})` : ""}: ${[...c.joined.map(x => `${esc(x.name)} joined the ${esc(x.court)}`), ...c.left.map(x => `${esc(x.name)} left the ${esc(x.court)}`)].join("; ")}.</li>`).join("")}</ul>` : `<p class="muted">No changes on record${state.st !== "all" ? " for " + state.st : ""} since weekly tracking began on ${D.stateTrackedSince ? longDate(D.stateTrackedSince) : "the first build"}. New appointments, elections and departures will appear here as the weekly checks find them.</p>`;
  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const rows = sel.filter(j => !q || [j.name, j.st, j.court, j.lawSchool, j.appointer].join(" ").toLowerCase().includes(q))
      .sort((a, b) => a.st.localeCompare(b.st) || a.court.localeCompare(b.court) || (b.chief - a.chief) || a.name.localeCompare(b.name));
    $("n-shown").textContent = `${fmtInt(rows.length)} shown`;
    $("s-table").innerHTML = `<table><thead><tr><th>Justice</th><th>Court</th><th class="num">Born</th><th class="num">Since</th><th>Selected</th><th>Party</th><th>Law school</th><th>Race on record</th></tr></thead><tbody>${rows.map(j => `<tr>
      <td>${j.wiki ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(j.wiki)}" rel="noreferrer">${esc(j.name)}</a>` : esc(j.name)}${j.chief ? ` <span class="pill">Chief</span>` : ""}</td>
      <td>${esc(j.court)}</td><td class="num">${j.born ?? "–"}</td><td class="num">${j.start ?? "–"}</td>
      <td>${j.selection === "Appointed" ? `Appointed${j.appointer ? ` by ${esc(j.appointer)}` : ""}` : "Elected"}</td>
      <td>${j.party ? `<i class="key" style="background:${PARTY[partyKey(j.party)].color}"></i>${esc(j.party)}` : "–"}</td>
      <td>${esc(j.lawSchool || "–")}</td><td>${j.race.group === "White or not recorded" ? `<span class="muted">–</span>` : esc(j.race.group)}</td></tr>`).join("")}</tbody></table>`;
    return rows;
  };
  let shown = draw();
  $("q").addEventListener("input", e => { state.q = e.target.value; shown = draw(); });
  $("csv-state").addEventListener("click", () => downloadCSV("state-supreme-court-justices.csv",
    ["state", "court", "name", "chief", "gender", "birth_year", "start_year", "term_ends", "selection", "appointer", "party", "party_basis", "law_school", "race_on_record", "lgbtq_on_record", "wikipedia"],
    shown.map(j => [j.st, j.court, j.name, j.chief ? "yes" : "", j.gender, j.born, j.start, j.termEnds, j.selection, j.appointer, j.party, j.partyBasis, j.lawSchool, j.race.group, j.lgbtq ? "yes" : "", j.wiki ? `https://en.wikipedia.org/wiki/${j.wiki}` : ""])));
}

// ---- Compared with the country --------------------------------------------------------------------------------------------
function compare() {
  const B = D.benchmarks, pop = B.population, bls = B.bls, aba = B.aba;
  const fed = sittingOn(TODAY, { level: "all", status: "active", party: "all", circuit: "all", gender: "all" }).map(s => s.j);
  const fedAll = sittingOn(TODAY, { level: "all", status: "all", party: "all", circuit: "all", gender: "all" }).map(s => s.j);
  const scotus = sittingOn(TODAY, { level: "Supreme Court", status: "active", party: "all", circuit: "all", gender: "all" }).map(s => s.j);
  const fedKnown = fed.filter(j => j.race !== "Not reported");
  const groups = [
    pop && { key: "pop", label: `U.S. adults (${pop.year})`, ref: true, women: pop.adults.women, black: pop.adults.black, hispanic: pop.adults.hispanic, asian: pop.adults.asian, white: pop.adults.whiteNH },
    bls && { ...bls.workforce, key: "work", label: `Everyone employed, BLS (${bls.year})`, ref: true },
    aba && { key: "aba", label: `Lawyers, ABA (${aba.year})`, ref: true, women: aba.women, black: aba.black, hispanic: aba.hispanic, asian: aba.asian, white: aba.white },
    bls && { ...bls.lawyers, key: "lawbls", label: `Lawyers, BLS (${bls.year})`, ref: true },
    bls && { ...bls.judges, key: "jbls", label: `Judges, magistrates and other judicial workers, BLS (${bls.year})`, ref: true },
    { key: "fed", label: "Active federal judges (today)", women: share(fed, j => j.gender === "F"), black: share(fedKnown, j => j.black), hispanic: share(fedKnown, j => j.hispanic), asian: share(fedKnown, j => j.asian), white: share(fedKnown, j => j.race === "White") },
    { key: "scotus", label: "Supreme Court (today)", women: share(scotus, j => j.gender === "F"), black: share(scotus, j => j.black), hispanic: share(scotus, j => j.hispanic), asian: share(scotus, j => j.asian), white: share(scotus, j => j.race === "White") },
    { key: "state", label: "State supreme court justices (today)", women: share(ST.filter(j => j.gender), j => j.gender === "F"), black: share(ST, j => j.black), hispanic: share(ST, j => j.hispanic), asian: share(ST, j => j.asian), white: null, lowerBound: true }
  ].filter(Boolean);
  const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const fedAge = median(fed.map(j => j.born ? yearOf(TODAY) - j.born : null)), stAge = median(ST.map(j => j.born ? yearOf(TODAY) - j.born : null));
  const usPop = pop?.all?.total;
  $("view").innerHTML = `
    <p class="summary">How the bench compares with the profession it is drawn from and the public it serves. Gray bars are the country and the legal profession; dark bars are judges.</p>
    <div class="tiles">
      ${aba ? tile("Lawyers in the U.S.", fmtInt(aba.lawyers), `active, ${aba.year} (ABA)`) : ""}
      ${aba ? tile("Lawyers per active federal judge", fmtInt(aba.lawyers / fed.length), `${fmtInt(fed.length)} active judges`) : ""}
      ${usPop ? tile("Americans per active federal judge", fmtInt(usPop / fed.length), `population ${(usPop / 1e6).toFixed(1)} million`) : ""}
      ${usPop ? tile("Americans per state high-court justice", fmtInt(usPop / ST.length), `${fmtInt(ST.length)} justices`) : ""}
      ${tile("Median age", `${fedAge ?? "–"} / ${stAge ?? "–"}`, `federal judges / state justices; U.S. adults ${pop?.adultMedianAge ?? "–"}`)}
      ${B.education ? tile("Adults with a graduate degree", fmtPct(B.education.graduate), `${fmtPct(B.education.professional)} hold a professional degree such as a J.D. (${B.education.year}, ages 25+); every judge does`) : ""}
      ${aba && pop ? tile("Adults who are lawyers", fmtPct(aba.lawyers / pop.adults.total), `about 1 in ${fmtInt(pop.adults.total / aba.lawyers)}`) : ""}
    </div>
    <div class="grid2">
      ${chart("k-women", "Women")}
      ${chart("k-black", "Black")}
      ${chart("k-hispanic", "Hispanic or Latino")}
      ${chart("k-asian", "Asian American")}
      ${chart("k-age", "Age", "Share of each group in each age band: U.S. adults (18 and over), active federal judges and state supreme court justices today. Bands are five years wide (18–19 is the first).", true)}
      ${chart("k-white", "White", "Non-Hispanic white where the source separates it (Census, ABA, FJC). BLS counts white people of any ethnicity, so its figure runs higher.", true)}
    </div>
    <p class="caveat">How groups are counted differs by source. The Census Bureau and BLS count Black and Asian Americans who report that race alone, and Hispanics of any race. The ABA reports one race per lawyer. Federal judges' race comes from the Federal Judicial Center; a judge who reports more than one race counts in each. State justices' race comes from Wikipedia's categories and is a lower bound. BLS figures are survey estimates of everyone working in the occupation, and its “judges” category also includes magistrates, hearing officers and other judicial workers at every level of government.</p>
    <h2 class="section-title">Sources for these comparisons</h2>
    <ul class="sources">
      ${pop ? `<li>Population: ${esc(pop.source)}. <a href="${esc(pop.url)}">Data file</a>.</li>` : ""}
      ${bls ? `<li>Workforce, lawyers and judges: ${esc(bls.source)}. <a href="${esc(bls.url)}">Table</a>.</li>` : ""}
      ${aba ? `<li>Lawyer population: ${esc(aba.source)}. <a href="${esc(aba.url)}">ABA Profile of the Legal Profession</a>.</li>` : ""}
      <li>Federal judges: Federal Judicial Center, Biographical Directory of Article III Federal Judges (${fmtInt(fedAll.length)} sitting today, ${fmtInt(fed.length)} of them active).</li>
      <li>State justices: Wikipedia and Wikidata, checked ${longDate(D.stateFetched)}.</li>
    </ul>`;
  if (pop?.adultAgeBands) {
    const bandOf = a => a < 20 ? 18 : Math.min(85, Math.floor(a / 5) * 5);
    const dist = ages => { const n = ages.length, out = {}; for (const a of ages) out[bandOf(a)] = (out[bandOf(a)] || 0) + 1 / n; return out; };
    const keys = Object.keys(pop.adultAgeBands).map(Number).sort((a, b) => a - b);
    const fedD = dist(fed.filter(j => j.born).map(j => yearOf(TODAY) - j.born)), stD = dist(ST.filter(j => j.born).map(j => yearOf(TODAY) - j.born));
    lines($("k-age"), [
      { label: "U.S. adults", color: "var(--axis)", points: keys.map(k => ({ x: k, y: pop.adultAgeBands[k] })) },
      { label: "Active federal judges", color: "var(--p-dem)", points: keys.map(k => ({ x: k, y: fedD[k] || 0 })) },
      { label: "State supreme court justices", color: "var(--p-whig)", points: keys.map(k => ({ x: k, y: stD[k] || 0 })) }
    ], { step: 5, yMin: 0, height: 240, xLabel: (x, long) => long ? (x === 18 ? "Ages 18–19" : x === 85 ? "Ages 85 and over" : `Ages ${x}–${x + 4}`) : String(x) });
  }
  for (const metric of ["women", "black", "hispanic", "asian", "white"]) {
    const items = groups.filter(g => g[metric] != null).map(g => ({ label: g.label, value: g[metric], cls: g.ref ? "ref" : "hl", lb: g.lowerBound }));
    hbars($(`k-${metric}`), items, { max: Math.max(...items.map(i => i.value), 0.01), tipText: i => `<b>${esc(i.label)}</b><br>${fmtPct(i.value)}${i.lb ? " (a lower bound)" : ""}` });
  }
}

// ---- Judges table (federal) -------------------------------------------------------------------------------------------------
const COLS = [
  ["name", "Name", r => r.j.last || r.j.name], ["court", "Court", r => r.court], ["pres", "Appointed by", r => r.pres || ""],
  ["start", "Since", r => r.start, true], ["age", "Age", r => ageOn(r, toDay(state.date)) ?? -1, true], ["race", "Race or ethnicity", r => r.j.race], ["law", "Law school", r => r.j.lawSchool || ""]
];
function members() {
  const day = toDay(state.date), sel = sittingOn(day, { circuit: state.circuit });
  const q = state.q.trim().toLowerCase();
  let rows = sel.filter(r => !q || [r.j.name, r.court, r.pres, r.j.lawSchool, r.j.race, r.st].join(" ").toLowerCase().includes(q));
  const col = COLS.find(c => c[0] === state.sort) || COLS[0];
  rows = rows.sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * state.dir; });
  $("view").innerHTML = `
    <p class="summary"><b>${fmtInt(sel.length)} ${state.status === "active" ? "active " : ""}${LEVEL_NAME[state.level]}</b> ${day === TODAY ? "sitting today" : `sitting on ${longDate(state.date)}`}. State justices are listed under <button class="link" data-tab="state">State supreme courts</button>.</p>
    <div class="table-tools">
      <input type="search" id="q" placeholder="Search names, courts, presidents or schools…" value="${esc(state.q)}" aria-label="Search judges">
      <span class="muted">${fmtInt(rows.length)} shown</span><button class="link" id="csv">Download CSV</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${COLS.map(([k, label, , num]) => `<th class="${num ? "num" : ""}"><button class="link" data-sort="${k}">${label}${state.sort === k ? (state.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}<th>Careers before the bench</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(r.j.name)}${isSenior(r, day) ? ` <span class="pill">Senior</span>` : ""}</td>
        <td>${esc(r.court.replace(/^U\.S\. /, "").replace("District Court for the ", "").replace("Court of Appeals for the ", ""))}</td>
        <td><i class="key" style="background:${PARTY[partyKey(r.party)].color}"></i>${esc(r.pres || "–")}</td>
        <td class="num">${yearOf(r.start)}</td><td class="num">${ageOn(r, day) ?? "–"}</td>
        <td>${esc(r.j.race)}</td><td>${esc(r.j.lawSchool || "–")}</td><td>${esc(r.j.careers.join("; "))}</td></tr>`).join("")}</tbody>
    </table></div>`;
  $("q").addEventListener("input", e => { state.q = e.target.value; const pos = e.target.selectionStart; members(); $("q").focus(); $("q").setSelectionRange(pos, pos); });
  $("csv").addEventListener("click", () => downloadCSV(`federal-judges-${state.date}.csv`,
    ["name", "court", "court_type", "state", "circuit", "appointing_president", "appointing_party", "aba_rating", "commissioned", "senior_status", "gender", "birth_year", "race_or_ethnicity", "law_school", "schools", "careers"],
    rows.map(r => [r.j.name, r.court, r.type, r.st, r.circuit, r.pres, r.party, r.aba, isoOf(r.start), r.senior != null ? isoOf(r.senior) : "", r.j.gender, r.j.born, r.j.raceLabel, r.j.lawSchool, r.j.schools.join("; "), r.j.careers.join("; ")])));
}

function downloadCSV(name, head, rows) {
  const cell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const url = URL.createObjectURL(new Blob([[head.join(","), ...rows.map(r => r.map(cell).join(","))].join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- About the data --------------------------------------------------------------------------------------------------------------
function about() {
  const B = D.benchmarks;
  $("view").innerHTML = `<div style="max-width:75ch">
    <h2 class="section-title">Federal judges</h2>
    <p>Every judge appointed under Article III of the Constitution since 1789 (Supreme Court, courts of appeals, district courts, and the Court of International Trade and its predecessors) from the Federal Judicial Center's <a href="https://www.fjc.gov/history/judges">Biographical Directory</a>, which the courts' own research agency keeps current. Magistrate, bankruptcy and territorial judges are not Article III judges and are not counted, though prior service in those posts shows up as a career.</p>
    <p><b>Sitting on a date</b> means commissioned on or before that date and not yet gone. <b>Active</b> leaves out judges who have taken senior status, a semi-retirement in which judges keep hearing cases with a reduced load. A judge elevated from a district court to a court of appeals counts once, in their newer seat.</p>
    <p><b>Race and ethnicity</b> are as reported to the FJC. Hispanic judges of any race count as Hispanic; judges who report two or more other races count as multiracial in the main chart and in each race in the comparisons.</p>
    <p><b>Careers before the bench</b> are classified from the FJC's list of each judge's prior positions: private practice; federal prosecutor (U.S. attorney or assistant); state or local prosecutor (district attorney, state's attorney and the like); public defender (including federal defenders and legal aid); state or local judge; federal magistrate or bankruptcy judge; law clerk; law professor or lecturer; military service; and elected office. A judge can have several.</p>
    <p><b>Law school</b> is where a judge earned their first law degree (J.D. or LL.B.), with school names grouped by university.</p>
    <h2 class="section-title">State supreme courts</h2>
    <p>No government agency publishes a national roster of state judges. This site reads the table of sitting justices on each state high court's Wikipedia article every week, for all 50 states, the District of Columbia Court of Appeals, and the Texas and Oklahoma courts of criminal appeals. Gender and missing birth years come from Wikidata. Race, ethnicity and LGBTQ identity come from Wikipedia's categories on each justice's article, which are incomplete and sometimes inconsistent, so treat them as lower bounds. Party is the justice's own party where they won a partisan election, or else the appointing governor's party as shown in Wikipedia's table.</p>
    <p>The roughly 30,000 judges on lower state courts are not covered: there is no open, current, person-level source for them. The BLS figures in <button class="link" data-tab="compare">Compared with the country</button> cover judges at every level, as a survey estimate.</p>
    <h2 class="section-title">National comparisons</h2>
    <ul class="sources">
      <li>${B.population ? esc(B.population.source) : "Census population estimates"}: shares of adults 18 and over.</li>
      <li>${B.bls ? esc(B.bls.source) : "BLS Current Population Survey, table 11"}: everyone employed, lawyers, and judges, magistrates and other judicial workers.</li>
      <li>${esc(B.aba.source)}: ${fmtInt(B.aba.lawyers)} active lawyers. The ABA does not allow automated downloads, so this figure is updated by hand when the ABA publishes each year's survey.</li>
    </ul>
    <h2 class="section-title">Updates</h2>
    <p>A scheduled job refetches every source each Monday and rebuilds the site. Federal data built ${esc(D.generated)}; state courts checked ${esc(D.stateFetched)}; benchmarks fetched ${esc(B.fetched || "–")}. If a source can't be reached, the last good copy is kept.</p>
    <p>Source code and data: <a href="https://github.com/jc0h3n/who-judges">github.com/jc0h3n/who-judges</a>. Built in the same way as <a href="https://jc0h3n.github.io/an-exact-portrait/">An Exact Portrait</a>, its companion on Congress.</p>
  </div>`;
}

// ---- Wiring ------------------------------------------------------------------------------------------------------------------------
function render() {
  renderControls(); writeHash();
  ({ federal, trends, state: stateView, compare, members: () => state.bench === "state" ? stateView() : members(), about })[state.tab]();
}
document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; state.q = ""; if (t.dataset.tab === "members") state.bench = "federal"; render(); scrollTo(0, 0); }
  else if (t.dataset.sort) { state.dir = state.sort === t.dataset.sort ? -state.dir : 1; state.sort = t.dataset.sort; members(); }
  else if (t.id === "reset") { const keep = state.tab; state = { ...DEFAULTS(), tab: keep }; render(); }
});
$("home").addEventListener("click", e => { e.preventDefault(); state = DEFAULTS(); render(); });
const bind = (id, key) => $(id).addEventListener("change", e => { state[key] = e.target.value || (key === "date" ? isoOf(TODAY) : "all"); render(); });
bind("f-level", "level"); bind("f-date", "date"); bind("f-status", "status"); bind("f-party", "party"); bind("f-circuit", "circuit");
bind("f-gender", "gender"); bind("f-state", "st"); bind("f-selection", "selection"); bind("f-sparty", "sparty");
addEventListener("hashchange", () => { if (D) { readHash(); render(); } });
let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.tab === "trends") render(); }, 200); });

fetch("data/judges.json").then(r => r.json()).then(raw => {
  D = raw; TODAY = toDay(new Date().toISOString().slice(0, 10)); decode(raw);
  state = DEFAULTS(); readHash();
  $("generated").textContent = `Data built ${raw.generated}.`;
  render();
}).catch(err => { $("view").innerHTML = `<p>Couldn't load the data file (${esc(err.message)}). If you opened this file directly, serve the folder instead, for example with <code>node scripts/serve.mjs</code>.</p>`; });
