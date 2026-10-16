#!/usr/bin/env bun
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createTwoFilesPatch } from "diff";
import { html as diff2html } from "diff2html";

const VENDOR = join(import.meta.dir, "vendor/road");
const GRAPHS = resolve(import.meta.dir, "../../../graphs");
const API = "https://www.beeminder.com/api/v1";
const API_VX = "https://www.beeminder.com/api/vx";
const SID = 86400;
const EPS = 1e-9;

const require = createRequire(import.meta.url);
const beebrain = require(join(VENDOR, "beebrain.js"));
const br = require(join(VENDOR, "broad.js"));
const bu = require(join(VENDOR, "butil.js"));

type Row = [string | null, number | null, number | null];
type Graph = { params: Record<string, any>; data: any[] };
type Run = { dir: string; goal: any; graph: Graph; before: Row[]; after: Row[] };

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function token(): string {
  const t = process.env.BEEMINDER_API_TOKEN;
  if (!t) die("BEEMINDER_API_TOKEN is not set");
  return t;
}

async function api(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok || body.errors) die(`${init?.method ?? "GET"} ${url.replace(/auth_token=[^&]+/, "auth_token=***")} -> ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  return body;
}

const authq = () => `auth_token=${encodeURIComponent(token())}`;
const fetchUser = async () => (await api(`${API}/users/me.json?${authq()}`)).username as string;
const fetchGoal = (user: string, goal: string) => api(`${API}/users/${user}/goals/${goal}.json?${authq()}`);
const fetchGraph = (user: string, goal: string) => api(`${API_VX}/users/${user}/goals/${goal}/graph.json?${authq()}`) as Promise<Graph>;

function daystamp(s: string): string {
  const d = s.replaceAll("-", "");
  if (!/^\d{8}$/.test(d)) die(`not a date: ${s} (use YYYY-MM-DD)`);
  return d;
}

const dayToT = (d: string): number => bu.dayparse(d);
const tToDay = (t: number): string => bu.dayify(t);
const addDays = (d: string, n: number) => tToDay(dayToT(d) + n * SID);
const weekday = (d: string) => new Date(dayToT(d) * 1000).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

// The goal endpoint returns roadall dates as unix timestamps; convert them to daystamps in the goal's timezone.
// The first row can keep its raw goal-creation timestamp, which may fall on the previous local day, so its date comes from graph.json's tini.
// The last row's timestamp can be UTC midnight, which falls on the previous local day west of UTC, so its date comes from graph.json's tfin.
function apiRoadall(goal: any, params: Graph["params"]): Row[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: params.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const last = goal.roadall.length - 1;
  return goal.roadall.map(([t, v, r]: [number | null, number | null, number | null], i: number) => [
    i == 0 ? params.tini : t == null ? null : i == last ? params.tfin : fmt.format(new Date(t * 1000)).replaceAll("-", ""),
    v,
    r,
  ]);
}

function validateRows(rows: Row[]) {
  if (rows.length < 2) die("roadall needs at least a first and a last row");
  rows.forEach((row, i) => {
    if (row.length != 3) die(`row ${i} must have 3 fields: ${JSON.stringify(row)}`);
    if (row.filter((x) => x == null).length != 1) die(`row ${i} must have exactly one null: ${JSON.stringify(row)}`);
    if (row[0] == null && i != rows.length - 1) die(`only the last row may have a null date: row ${i}`);
    if (row[0] != null) daystamp(row[0]);
  });
  if (rows[0]![2] != null || rows[0]![1] == null) die("first row must be [date, value, null]");
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]![0], b = rows[i]![0];
    if (a != null && b != null && b < a) die(`rows out of order at row ${i}: ${b} < ${a}`);
  }
}

function rowsToParams(rows: Row[]) {
  const last = rows[rows.length - 1]!;
  return { tini: rows[0]![0], vini: rows[0]![1], road: rows.slice(1, -1), tfin: last[0], vfin: last[1], rfin: last[2] };
}

function brain(graph: Graph, rows: Row[]): any {
  validateRows(rows);
  const params = { ...graph.params, ...rowsToParams(rows) };
  const b = new beebrain(structuredClone({ params, data: graph.data }));
  const stats = b.getStats();
  if (stats.error) die(`beebrain rejected the line: ${stats.error}`);
  return b;
}

const sameValue = (a: number | null, b: number | null) => (a == null || b == null ? a == b : Math.abs(a - b) < EPS);
const sameRows = (a: Row[], b: Row[]) =>
  a.length == b.length && a.every((r, i) => r[0] == b[i]![0] && sameValue(r[1], b[i]![1]) && sameValue(r[2], b[i]![2]));

function checkConsistent(graph: Graph, rows: Row[]) {
  const p = rowsToParams(rows), g = graph.params;
  const ok = p.tini == g.tini && sameValue(p.vini, g.vini) && sameRows(p.road, g.road) &&
    p.tfin == (g.tfin ?? null) && sameValue(p.vfin, g.vfin ?? null) && sameValue(p.rfin, g.rfin ?? null);
  if (!ok) die(`goal roadall and graph.json disagree; the timezone conversion is wrong\nroadall: ${JSON.stringify(rows)}\ngraph: ${JSON.stringify({ tini: g.tini, vini: g.vini, road: g.road, tfin: g.tfin, vfin: g.vfin, rfin: g.rfin })}`);
}

const fmtRows = (rows: Row[]) => "[\n" + rows.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n]\n";

async function loadRun(dir: string): Promise<Run> {
  const read = (f: string) => Bun.file(join(dir, f)).json();
  return { dir, goal: await read("goal.json"), graph: await read("graph.json"), before: await read("before.roadall.json"), after: await read("after.roadall.json") };
}

async function cmdNew(goalSlug: string) {
  const user = await fetchUser();
  const [goal, graph] = await Promise.all([fetchGoal(user, goalSlug), fetchGraph(user, goalSlug)]);
  const rows = apiRoadall(goal, graph.params);
  checkConsistent(graph, rows);
  const stamp = new Date().toLocaleString("sv-SE").replace(" ", "T").replaceAll(":", "-");
  const dir = join(GRAPHS, goalSlug, stamp);
  if (await Bun.file(join(dir, "goal.json")).exists()) die(`${dir} already exists`);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "goal.json"), JSON.stringify(goal, null, 2));
  await Bun.write(join(dir, "graph.json"), JSON.stringify(graph, null, 2));
  await Bun.write(join(dir, "before.roadall.json"), fmtRows(rows));
  await Bun.write(join(dir, "after.roadall.json"), fmtRows(rows));
  console.log(dir);
}

function printRows(label: string, rows: Row[]) {
  console.log(`${label}:`);
  rows.forEach((r, i) => {
    const jump = i > 0 && r[0] != null && rows[i - 1]![0] == r[0] ? "  <- jump" : "";
    console.log(`  ${r[0] ? `${weekday(r[0])} ${r[0]}` : "      (end)"}  ${JSON.stringify(r)}${jump}`);
  });
}

async function cmdShow(dir: string) {
  const run = await loadRun(dir);
  const p = run.graph.params;
  console.log(`${p.yoog}  yaw=${p.yaw} runits=${p.runits} aggday=${p.aggday} timezone=${p.timezone} asof=${p.asof}`);
  printRows("before", run.before);
  if (!sameRows(run.before, run.after)) printRows("after", run.after);
  else console.log("after: unchanged");
}

// A break is days off from `from` through `to` inclusive: the line jumps to `height` at the start of
// `from` and drops back to its original value at the start of the day after `to`.
async function cmdBreak(dir: string, opts: Record<string, string>) {
  const run = await loadRun(dir);
  if (run.graph.params.yaw != -1) die("breaks are only implemented as upward jumps on do-less goals (yaw -1); edit after.roadall.json by hand");
  if (!opts.from || !opts.to) die("break needs --from and --to");
  const from = daystamp(opts.from), to = daystamp(opts.to), resume = addDays(to, 1);
  const height = opts.height == null ? 1000 : Number(opts.height);
  if (!Number.isFinite(height)) die(`bad --height: ${opts.height}`);
  if (to < from) die("--to is before --from");

  const rows = run.after;
  const b = brain(run.graph, rows);
  const tini = rows[0]![0]!, tfin = tToDay(b.gol.tfin);
  const akh: number = bu.CONSISTENT_AKRASIA_HORIZON ? b.gol.horizon : b.gol.asof + bu.AKH;
  if (dayToT(from) <= akh) die(`break must start after the akrasia horizon (${tToDay(akh)})`);
  if (from <= tini) die(`break must start after the line starts (${tini})`);
  if (resume >= tfin) die(`break must end before the line ends (${tfin})`);

  const replaced = rows.slice(1, -1).filter((r) => r[0]! >= from && r[0]! <= resume);

  const line = (d: string) => br.rdf(b.roads, dayToT(d));
  const lineBefore = (d: string) => br.rdf(b.roads, dayToT(d) - 1);
  if (height <= Math.max(lineBefore(from), line(resume))) die(`--height ${height} is not above the line around the break`);

  const next: Row[] = [
    ...rows.slice(0, -1).filter((r, i) => i == 0 || r[0]! < from),
    [from, lineBefore(from), null],
    [from, height, null],
    [resume, height, null],
    [resume, line(resume), null],
    ...rows.slice(1).filter((r, i) => i == rows.length - 2 || r[0]! > resume),
  ];

  const nb = brain(run.graph, next);
  for (let t = dayToT(tini); t <= b.gol.tfin; t += SID) {
    const d = tToDay(t);
    const want = d >= from && d <= to ? height : line(d);
    const got = br.rdf(nb.roads, t);
    if (Math.abs(got - want) > EPS) die(`internal error: new line is ${got} on ${d}, expected ${want}; nothing written`);
  }
  await Bun.write(join(dir, "after.roadall.json"), fmtRows(next));
  if (replaced.length) console.log(`replaced rows: ${replaced.map((r) => JSON.stringify(r)).join(" ")}`);
  console.log(`break ${weekday(from)} ${from} .. ${weekday(to)} ${to} at ${height}, back to ${line(resume)} on ${weekday(resume)} ${resume}`);
}

function ranges(days: string[]): string {
  const out: string[] = [];
  let start: string | null = null, prev: string | null = null;
  for (const d of [...days, null]) {
    if (d != null && prev != null && addDays(prev, 1) == d) { prev = d; continue; }
    if (start) out.push(start == prev ? start : `${start}..${prev}`);
    start = prev = d;
  }
  return out.join(", ");
}

function check(run: Run): { failed: boolean; report: string } {
  const lines: string[] = [];
  let failed = false;
  const fail = (m: string) => { failed = true; lines.push(`FAIL  ${m}`); };
  const warn = (m: string) => lines.push(`WARN  ${m}`);
  const ok = (m: string) => lines.push(`ok    ${m}`);

  const before = brain(run.graph, run.before), after = brain(run.graph, run.after);
  const gol = after.gol, yaw: number = gol.yaw;
  const akh: number = bu.CONSISTENT_AKRASIA_HORIZON ? gol.horizon : gol.asof + bu.AKH;
  const lb = (t: number) => br.rdf(before.roads, t), la = (t: number) => br.rdf(after.roads, t);
  const bad = (v: number, line: number) => yaw * (v - line) < -EPS;

  const start = Math.min(before.gol.tini, gol.tini), end = Math.max(before.gol.tfin, gol.tfin);
  const changed: string[] = [];
  for (let t = start; t <= end; t += SID) if (Math.abs(lb(t) - la(t)) > EPS) changed.push(tToDay(t));
  lines.push(changed.length ? `line changes on: ${ranges(changed)}` : "line is unchanged");

  const newlyBad = after.data
    .filter((d: any[]) => d[0] <= gol.asof && bad(d[1], la(d[0])) && !bad(d[1], lb(d[0])))
    .map((d: any[]) => `${tToDay(d[0])} (value ${d[1]}, line ${lb(d[0])} -> ${la(d[0])})`);
  if (newlyBad.length) fail(`past days that would end up on the wrong side of the line: ${newlyBad.join("; ")}`);
  else ok("no past datapoint moves to the wrong side of the line");

  const sb = before.getStats(), sa = after.getStats();
  if (sa.loser) fail(`beebrain says the goal is derailed with the new line${sb.loser ? " (it already is with the current one)" : ""}`);
  else ok(`not derailed; safe days ${sb.safebuf} -> ${sa.safebuf}`);

  const easier: string[] = [];
  for (let t = gol.asof; t <= akh; t += SID) if (yaw * (la(t) - lb(t)) < -EPS) easier.push(tToDay(t));
  if (easier.length) fail(`line gets easier inside the akrasia horizon (through ${tToDay(akh)}): ${ranges(easier)}`);
  else ok(`no easier days inside the akrasia horizon (through ${tToDay(akh)})`);

  const past = changed.filter((d) => dayToT(d) < gol.asof);
  if (past.length) warn(`line changes in the past: ${ranges(past)}`);

  return { failed, report: lines.join("\n") + "\n" };
}

async function cmdCheck(dir: string) {
  const { failed, report } = check(await loadRun(dir));
  await Bun.write(join(dir, "check.txt"), report);
  process.stdout.write(report);
  if (failed) process.exit(1);
}

const VENDOR_SCRIPTS = ["d3.v7.min.js", "fili.js", "moment.js", "polyfit.js", "butil.js", "broad.js", "beebrain.js", "bgraph.js"];
const W = 696, H = 453;

async function cmdRender(dir: string, opts: Record<string, string>) {
  const run = await loadRun(dir);
  const descFile = Bun.file(join(dir, "description.html"));
  if (!(await descFile.exists())) die(`write ${join(dir, "description.html")} describing the change before rendering`);
  const description = (await descFile.text()).trim();
  if (!description) die("description.html is empty");
  const { report } = check(run);
  const before = brain(run.graph, run.before), after = brain(run.graph, run.after);
  let t1: number, t2: number;
  if (opts.from || opts.to) {
    if (!opts.from || !opts.to) die("render needs both --from and --to, or neither");
    t1 = dayToT(daystamp(opts.from)); t2 = dayToT(daystamp(opts.to));
  } else {
    const changed: number[] = [];
    for (let t = Math.min(before.gol.tini, after.gol.tini); t <= Math.max(before.gol.tfin, after.gol.tfin); t += SID)
      if (Math.abs(br.rdf(before.roads, t) - br.rdf(after.roads, t)) > EPS) changed.push(t);
    t1 = (changed.length ? changed[0]! : after.gol.asof) - 14 * SID;
    t2 = (changed.length ? changed[changed.length - 1]! : after.gol.asof + 16 * SID) + 14 * SID;
  }

  // Beebrain's default y range covers the data, not the line, so a tall break would run off the top.
  // Both graphs share one range so they compare directly.
  let vmin = Math.min(before.gol.vmin, after.gol.vmin), vmax = Math.max(before.gol.vmax, after.gol.vmax);
  for (let t = t1; t <= t2; t += SID)
    for (const roads of [before.roads, after.roads]) {
      const v = br.rdf(roads, t);
      vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
    }
  if (opts.vmin != null) vmin = Number(opts.vmin);
  if (opts.vmax != null) vmax = Number(opts.vmax);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin >= vmax) die(`bad y range: --vmin ${vmin} --vmax ${vmax}`);

  const chromium = Bun.which("chromium") ?? die("chromium is not on PATH");
  const profile = await mkdtemp(join(tmpdir(), "bee-chromium-"));
  const browser = await puppeteer.launch({
    executablePath: chromium,
    userDataDir: profile,
    // crashpad refuses to start when it cannot write under XDG dirs, which a sandboxed home may not allow
    env: { ...process.env, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: profile },
    args: ["--headless=new", "--disable-crash-reporter", "--disable-breakpad"],
  });
  try {
    for (const [name, rows] of [["before", run.before], ["after", run.after]] as const) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (/error/i.test(m.text())) errors.push(m.text()); });
      await page.setViewport({ width: W, height: H });
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:#fff"><div id="g" style="width:${W}px;height:${H}px"></div></body></html>`);
      await page.addStyleTag({ path: join(VENDOR, "jsbrain.css") });
      for (const s of VENDOR_SCRIPTS) await page.addScriptTag({ path: join(VENDOR, s) });
      const goal = { params: { ...run.graph.params, ...rowsToParams(rows), vmin, vmax }, data: run.graph.data };
      await page.evaluate(async (goal, t1, t2, W, H) => {
        // @ts-ignore bgraph is a browser global from the vendored scripts
        const graph = new bgraph({
          divGraph: document.getElementById("g"), svgSize: { width: W, height: H },
          focusRect: { x: 0, y: 0, width: W, height: H }, ctxRect: { x: 0, y: H, width: W, height: 32 },
          roadEditor: false, headless: true, maxFutureDays: 365, showFocusRect: false, showContext: false,
        });
        graph.loadGoalJSON(goal);
        graph.setZoomRange(t1, t2);
        await new Promise((r) => setTimeout(r, 300));
      }, goal, t1, t2, W, H);
      if (errors.length) die(`rendering ${name} failed: ${errors.join("; ")}`);
      const svg = await page.$("#g svg") ?? die(`rendering ${name} produced no svg`);
      await svg.screenshot({ path: join(dir, `${name}.png`) });
      await page.close();
    }
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }

  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const patch = createTwoFilesPatch("roadall.json", "roadall.json", fmtRows(run.before), fmtRows(run.after));
  const diffHtml = diff2html(patch, { drawFileList: false, outputFormat: "line-by-line" });
  const diffCss = await Bun.file(require.resolve("diff2html/bundles/css/diff2html.min.css")).text();
  // The page links the vendored scripts in place, so it only works from inside the repo.
  const vendorPath = relative(resolve(dir), VENDOR);
  const goals = { before: { params: { ...run.graph.params, ...rowsToParams(run.before) }, data: run.graph.data }, after: { params: { ...run.graph.params, ...rowsToParams(run.after) }, data: run.graph.data } };
  const goalsJson = JSON.stringify(goals).replace(/</g, "\\u003c");
  await Bun.write(join(dir, "index.html"), `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(run.graph.params.yoog)}</title>
<style>body{font-family:sans-serif;margin:16px}.pair{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}pre{background:#f4f4f4;padding:8px}.desc{max-width:80ch}</style>
<style>${diffCss}</style>
<link rel="stylesheet" href="${vendorPath}/jsbrain.css">
${VENDOR_SCRIPTS.map((s) => `<script src="${vendorPath}/${s}"></script>`).join("\n")}
</head><body>
<h1>${esc(run.graph.params.yoog)}</h1>
<h2>Summary</h2>
<div class="desc">${description}</div>
<h2>Before/After</h2>
<p>Starting view: ${tToDay(t1)} to ${tToDay(t2)}. Ctrl+scroll to zoom, drag to pan; both graphs move together. <button id="reset">Reset view</button></p>
<div class="pair">
<figure><figcaption>Before</figcaption><div id="g-before" style="width:${W}px"></div></figure>
<figure><figcaption>After</figcaption><div id="g-after" style="width:${W}px"></div></figure>
</div>
<script>
const GOALS = ${goalsJson};
const graphs = [];
for (const name of ["before", "after"]) {
  const g = new bgraph({
    divGraph: document.getElementById("g-" + name), roadEditor: false, headless: false, scrollZoom: true, buttonZoom: true,
    showContext: true, showFocusRect: true, maxFutureDays: 365,
    onZoom: (t1, t2) => graphs.forEach((other) => { if (other != g) other.setZoomRange(t1, t2); }),
  });
  graphs.push(g);
  g.loadGoalJSON(GOALS[name]);
}
const reset = () => graphs.forEach((g) => g.setZoomRange(${t1}, ${t2}));
setTimeout(reset, 300);
document.getElementById("reset").onclick = reset;
</script>
<h2>Safety Check</h2><pre>${esc(report)}</pre>
<h2>Data</h2>
<h3>Diff</h3>
${diffHtml}
<h3>Before/After</h3>
<div class="pair">
<figure><figcaption>Before</figcaption><pre>${esc(fmtRows(run.before))}</pre></figure>
<figure><figcaption>After</figcaption><pre>${esc(fmtRows(run.after))}</pre></figure>
</div>
</body></html>
`);
  console.log(join(dir, "index.html"));
}

async function cmdApply(dir: string) {
  const run = await loadRun(dir);
  const { failed, report } = check(run);
  process.stdout.write(report);
  if (failed) die("checks failed; nothing sent");
  if (sameRows(run.before, run.after)) die("after.roadall.json is identical to before; nothing to send");

  const user = await fetchUser(), slug = run.goal.slug;
  const [currentGoal, currentGraph] = await Promise.all([fetchGoal(user, slug), fetchGraph(user, slug)]);
  const current = apiRoadall(currentGoal, currentGraph.params);
  if (!sameRows(current, run.before)) die(`the goal's line changed since ${dir} was created; start a new run\n${fmtRows(current)}`);

  const res = await api(`${API}/users/${user}/goals/${slug}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth_token: token(), roadall: JSON.stringify(run.after) }),
  });
  await Bun.write(join(dir, "apply-response.json"), JSON.stringify(res, null, 2));

  const graph = await fetchGraph(user, slug);
  const stored = apiRoadall(await fetchGoal(user, slug), graph.params);
  await Bun.write(join(dir, "applied.roadall.json"), fmtRows(stored));
  const want = brain(run.graph, run.after), got = brain(graph, stored);
  const diff: string[] = [];
  for (let t = want.gol.tini; t <= want.gol.tfin; t += SID)
    if (Math.abs(br.rdf(want.roads, t) - br.rdf(got.roads, t)) > EPS) diff.push(tToDay(t));
  if (diff.length) die(`Beeminder stored a different line than was sent; differs on ${ranges(diff)}; see applied.roadall.json`);
  console.log(`applied; Beeminder's stored line matches after.roadall.json${sameRows(stored, run.after) ? "" : " (rows normalized differently)"}`);
}

function parseOpts(args: string[]): { pos: string[]; opts: Record<string, string> } {
  const pos: string[] = [], opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) opts[a.slice(2)] = args[++i] ?? die(`${a} needs a value`);
    else pos.push(a);
  }
  return { pos, opts };
}

const USAGE = `usage: bun bee.ts <command> ...
  new <goal>                                  fetch a goal into graphs/<goal>/<timestamp>/
  show <dir>                                  print the before and after rows
  break <dir> --from D --to D [--height V]    add days off, inclusive (default height 1000)
  check <dir>                                 run the safety checks on after.roadall.json
  render <dir> [--from D --to D] [--vmin V] [--vmax V]
                                              write before.png, after.png and index.html
  apply <dir>                                 re-check, then PUT after.roadall.json`;

const [cmd, ...rest] = process.argv.slice(2);
const { pos, opts } = parseOpts(rest);
const arg = pos[0] ?? die(USAGE);
switch (cmd) {
  case "new": await cmdNew(arg); break;
  case "show": await cmdShow(arg); break;
  case "break": await cmdBreak(arg, opts); break;
  case "check": await cmdCheck(arg); break;
  case "render": await cmdRender(arg, opts); break;
  case "apply": await cmdApply(arg); break;
  default: die(USAGE);
}
