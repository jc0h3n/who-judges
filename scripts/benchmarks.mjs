// National benchmarks shared by the build: what the U.S. population and workforce look like.
// Every function returns plain numbers with a source line and URL, or throws (the caller keeps the last good copy).
//   population()  Census Bureau population estimates: sex, race and Hispanic origin, adults' median age
//   education()   Census Bureau, Current Population Survey: educational attainment of people 25 and over
//   veterans()    Bureau of Labor Statistics: veterans as a share of the civilian population 18 and over
//   occupations() Bureau of Labor Statistics, CPS table 11: everyone employed, lawyers, judges
import { inflateRawSync } from "node:zlib";

const UA = "public-data-build/1.0 (https://github.com/jc0h3n; open-data build script)";
export const BROWSER = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
    if (r.ok) return r;
    if (attempt >= 3 || (r.status !== 429 && r.status < 500)) throw new Error(`${r.status} ${r.statusText} for ${url.slice(0, 140)}`);
    await sleep(6000 * attempt);
  }
}
const CENSUS = "https://www2.census.gov/programs-surveys";

// ---- Minimal .xlsx reader (zip + shared strings + one worksheet) ----------------------------------------------
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(data) : data;
    p += 46 + nameLen + extra + comment;
  }
  return files;
}
const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export function readXlsx(buf, sheet = 1) {
  const z = unzip(buf);
  const shared = [...(z["xl/sharedStrings.xml"]?.toString("utf8") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join("")));
  const xml = z[`xl/worksheets/sheet${sheet}.xml`].toString("utf8");
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = [...c[1]].reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/)?.[1], inline = (c[3] || "").match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      row[col] = /t="s"/.test(c[2]) ? shared[+v] : inline != null ? unxml(inline) : v != null ? (isNaN(+v) ? unxml(v) : +v) : null;
    }
    rows.push(row);
  }
  return rows;
}

// ---- Population (Census Bureau population estimates) ------------------------------------------------------------
export async function population() {
  const dirs = (await (await get(`${CENSUS}/popest/datasets/`)).text()).match(/20[0-9]0-20[0-9]{2}(?=\/)/g) || [];
  // Each vintage is split into numbered files by period; the newest July 1 estimate of the vintage year is in the
  // highest-numbered file that has one (later files carry short-term projections).
  for (const dir of [...new Set(dirs)].sort().reverse()) for (let n = 14; n >= 1; n--) {
    const v = dir.slice(-4), url = `${CENSUS}/popest/datasets/${dir}/national/asrh/nc-est${v}-alldata-r-file${String(n).padStart(2, "0")}.csv`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) continue;
    const lines = (await r.text()).trim().split(/\r?\n/), head = lines[0].split(",");
    const rows = lines.slice(1).map(l => Object.fromEntries(l.split(",").map((x, i) => [head[i], x])));
    const julys = rows.filter(r => +r.MONTH === 7 && +r.YEAR <= +v);
    if (!julys.length) continue;
    const year = Math.max(...julys.map(r => +r.YEAR)), yr = julys.filter(r => +r.YEAR === year);
    const num = (r, k) => +r[k], both = (r, k) => num(r, `${k}_MALE`) + num(r, `${k}_FEMALE`);
    const sum = (filter, f) => yr.filter(filter).reduce((t, r) => t + f(r), 0);
    const group = filter => {
      const total = sum(filter, r => num(r, "TOT_POP")), sh = k => sum(filter, r => both(r, k)) / total;
      return { total, women: sum(filter, r => num(r, "TOT_FEMALE")) / total, whiteNH: sh("NHWA"), black: sh("BA"), blackAny: sh("BAC"), hispanic: sh("H"),
        asian: sh("AA"), asianAny: sh("AAC"), native: sh("IA"), nativeAny: sh("IAC"), pacific: sh("NA"), multi: sh("TOM") };
    };
    const ages = yr.filter(r => r.AGE !== "999").map(r => ({ age: +r.AGE, n: num(r, "TOT_POP") })).sort((a, b) => a.age - b.age);
    const medianFrom = min => { const a = ages.filter(x => x.age >= min), half = a.reduce((t, x) => t + x.n, 0) / 2; let acc = 0; for (const x of a) { acc += x.n; if (acc >= half) return x.age; } };
    // Age distribution of adults in five-year bands, for comparing with the age of officeholders
    const bands = {};
    for (const x of ages.filter(x => x.age >= 18)) { const b = x.age < 20 ? 18 : Math.min(85, Math.floor(x.age / 5) * 5); bands[b] = (bands[b] || 0) + x.n; }
    const adultTotal = ages.filter(x => x.age >= 18).reduce((t, x) => t + x.n, 0);
    return { source: `U.S. Census Bureau, Vintage ${v} population estimates (resident population, July 1, ${year})`, url, year,
      all: group(r => r.AGE === "999"), adults: group(r => r.AGE !== "999" && +r.AGE >= 18), adults25: group(r => r.AGE !== "999" && +r.AGE >= 25),
      adultMedianAge: medianFrom(18), medianAge: medianFrom(0),
      adultAgeBands: Object.fromEntries(Object.entries(bands).map(([b, n]) => [b, n / adultTotal])) };
  }
  throw new Error("no population estimates file found");
}

// ---- Educational attainment (CPS detailed tables, people 25 and over) ------------------------------------------------
export async function education() {
  const years = ((await (await get(`${CENSUS}/demo/tables/educational-attainment/`)).text()).match(/href="(20\d\d)\//g) || []).map(h => +h.slice(6, 10)).sort().reverse();
  for (const y of years) {
    // The table of all races, both sexes, is "table-1-1.xlsx" through 2022 and "attain01_YYYY_1.xlsx" since
    let url, r;
    for (const f of [`attain01_${y}_1.xlsx`, "table-1-1.xlsx"]) {
      url = `${CENSUS}/demo/tables/educational-attainment/${y}/cps-detailed-tables/${f}`;
      r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.ok) break;
    }
    if (!r.ok) continue;
    const rows = readXlsx(Buffer.from(await r.arrayBuffer()));
    // The header row names each attainment column; the first data row labeled "25 years and over" is everyone 25+.
    const hi = rows.findIndex(row => row?.some(c => typeof c === "string" && /bachelor/i.test(c)));
    const head = rows[hi].map(c => String(c ?? "").toLowerCase().replace(/\s+/g, " "));
    const total = rows.slice(hi + 1).find(row => typeof row?.[0] === "string" && /^\.*\s*25 years and over/i.test(row[0].trim()));
    const col = re => head.findIndex(h => re.test(h));
    const v = re => +total[col(re)];
    const all = v(/^total/), bach = v(/^bachelor/), mast = v(/^master/), prof = v(/^professional/), doct = v(/^doctoral/);
    if (!(all > 0 && bach > 0 && prof > 0)) throw new Error("education table layout changed");
    return { source: `U.S. Census Bureau, Current Population Survey, Educational Attainment in the United States: ${y}, table 1-1 (people 25 and over)`, url, year: y,
      bachelorsOrMore: (bach + mast + prof + doct) / all, graduate: (mast + prof + doct) / all, professional: prof / all, doctoral: doct / all };
  }
  throw new Error("no educational attainment table found");
}

// ---- Veterans (BLS public API, Current Population Survey annual averages) ---------------------------------------------
// LNU00049526: veterans, 18 years and over; LNU00049601: nonveterans, 18 years and over (civilian noninstitutional population)
export async function veterans() {
  const y = new Date().getUTCFullYear();
  const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ seriesid: ["LNU00049526", "LNU00049601"], startyear: String(y - 2), endyear: String(y), annualaverage: true }) });
  const j = await r.json();
  if (j.status !== "REQUEST_SUCCEEDED") throw new Error("BLS API: " + j.status);
  const annual = id => (j.Results.series.find(x => x.seriesID === id)?.data || []).filter(d => d.period === "M13");
  const v = annual("LNU00049526"), n = annual("LNU00049601");
  const year = v.map(d => +d.year).find(yr => n.some(d => +d.year === yr));
  if (!year) throw new Error("no annual average yet");
  const vets = +v.find(d => +d.year === year).value, non = +n.find(d => +d.year === year).value;
  return { source: `U.S. Bureau of Labor Statistics, Current Population Survey, ${year} annual averages (series LNU00049526 and LNU00049601)`,
    url: "https://data.bls.gov/timeseries/LNU00049526", year, adultsShare: vets / (vets + non), veterans: vets * 1000 };
}

// ---- Occupations (BLS, CPS table 11) --------------------------------------------------------------------------------
export async function occupations(labels) {
  const url = "https://www.bls.gov/cps/cpsaat11.htm";
  const html = await (await get(url, BROWSER)).text();
  const year = +(html.match(/colspan="6">(\d{4})</) || [])[1];
  const rows = {};
  for (const m of html.matchAll(/<tr[^>]*><th[^>]*>\s*<p class="sub\d">([^<]+)<\/p>\s*<\/th>([\s\S]*?)<\/tr>/g))
    rows[m[1].trim()] = [...m[2].matchAll(/<span class="datavalue">([^<]*)</g)].map(x => x[1].replace(/,/g, ""));
  if (!year) throw new Error("BLS table year not found");
  const pct = x => x === "–" || x === "-" || x === "" ? null : +x / 100;
  const out = { source: `U.S. Bureau of Labor Statistics, Current Population Survey, ${year} annual averages, table 11`, url, year };
  for (const [key, label] of Object.entries(labels)) {
    const v = rows[label]; if (!v || v.length < 6) throw new Error("BLS row missing: " + label);
    out[key] = { label, employed: +v[0] * 1000, women: pct(v[1]), white: pct(v[2]), black: pct(v[3]), asian: pct(v[4]), hispanic: pct(v[5]) };
  }
  return out;
}
