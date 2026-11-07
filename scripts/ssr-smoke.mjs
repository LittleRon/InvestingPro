// Real SSR smoke check: serves fake api data, starts the BUILT web server, and requests every
// macro-dashboard page the way a browser reload does (server-rendered, no browser globals).
//
//   npm run build -w @aihot/web && node scripts/ssr-smoke.mjs
//
// A page that only works after a client-side navigation but 500s on a hard reload is exactly what
// this catches. It also feeds the pages incomplete/legacy payloads: any render-time dereference of
// a missing field becomes a 500, so this is the guard against both classes of bug.
import { createServer } from "node:http";
import { spawn } from "node:child_process";

/** Ask the OS for a free port, then close; enough to pick two before anything else grabs them. */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const weight = (key, name, w) => ({ key, name, weight: w, amount: w * 10000, holdings: w * 9000, diff: w * 1000 });
const weights = [
  weight("stocks", "股票", 30), weight("bonds", "债券", 25), weight("commodities", "大宗商品", 15),
  weight("cash", "现金", 20), weight("gold", "黄金", 10),
];
const allocation = { weights, totalAssets: 1_000_000, notes: ["规则引擎参考"] };
const horizons = { short: { ...allocation }, medium: { ...allocation }, long: { ...allocation } };
const allocData = {
  clock: { quadrantName: "复苏", growth: { trend: 1, value: 50, at: null, label: "回升" }, inflation: { value: 2, ppi: null, cpi: 2, at: null, label: "温和" } },
  cycles: [], allocation, horizons,
};

const fullInterp = {
  scope: "CN", at: "2026-11-07", model: "default", generation: 2, regeneratedAt: "2026-11-07T02:30:00.000Z",
  payload: {
    interpretation: "这是一段 AI 解读正文。", watchpoints: ["关注 PPI", "关注 CPI"],
    snapshot: {
      quadrant: "复苏", cycles: "短周期上升", shortWeights: "股票 30%", mediumWeights: "债券 25%",
      longWeights: "黄金 10%", holdings: "股票 40 万", totalAssets: "1000000", notes: ["口径说明"],
    },
  },
};
const fullReport = {
  scope: "CN", at: "2026-11-07", model: "default",
  payload: {
    political: "政治象限", economic: "经济象限", social: "社会象限", technological: "技术象限",
    watchpoints: ["看 PPI", "看 CPI"], snapshot: "原始宏观数据快照",
  },
  status: { job: "macro.report", status: "ok", at: "2026-11-07", error: null, detail: { written: true } },
};

/** Each case: what the api returns, and which pages must still render (200, with their marker). */
const CASES = [
  { name: "完整数据（有报告 + 有解读）", alloc: allocData, interp: fullInterp, report: fullReport },
  { name: "还没有任何报告 / 解读", alloc: allocData, interp: { missing: "还没有生成解读" }, report: { scope: "CN", at: null, missing: "这一天的报告还没有生成", status: null } },
  { name: "解读 payload 缺字段（旧格式记录）", alloc: allocData, interp: { scope: "CN", at: "2026-11-07", generation: 1, payload: { interpretation: "正文" } }, report: fullReport },
  { name: "解读 payload 为 null", alloc: allocData, interp: { scope: "CN", at: "2026-11-07", generation: 1, payload: null }, report: fullReport },
  { name: "解读缺 payload 整体", alloc: allocData, interp: { scope: "CN", at: "2026-11-07", generation: 1 }, report: fullReport },
  { name: "解读时间戳非法", alloc: allocData, interp: { ...fullInterp, regeneratedAt: "不是时间" }, report: fullReport },
  { name: "报告 payload 缺 watchpoints / snapshot", alloc: allocData, interp: fullInterp, report: { scope: "CN", at: "2026-11-07", payload: { political: "P" } } },
  { name: "报告 payload 为 null", alloc: allocData, interp: fullInterp, report: { scope: "CN", at: "2026-11-07", payload: null } },
  { name: "组合配置接口返回空对象", alloc: {}, interp: fullInterp, report: fullReport },
  { name: "组合配置接口返回 null", alloc: null, interp: fullInterp, report: fullReport },
  { name: "所有接口都返回畸形数据", alloc: { clock: null, horizons: "坏值" }, interp: { payload: {} }, report: { at: "2026-11-07", payload: { watchpoints: "坏值" } } },
  {
    name: "生成任务运行中（状态接口返回 running）", alloc: allocData, interp: { missing: "还没有生成解读" },
    report: { scope: "CN", at: null, missing: "这一天的报告还没有生成", status: null },
    status: {
      expectedSeconds: 180,
      report: { running: true, lastStatus: "running", lastError: null, detail: null, startedAt: "2026-11-07T02:30:00.000Z", at: null, writtenAt: null },
      interpretation: { running: true, lastStatus: "running", lastError: null, startedAt: "2026-11-07T02:30:00.000Z", generation: 0, at: null },
    },
  },
  {
    name: "生成任务失败（带错误原因）", alloc: allocData, interp: { missing: "还没有生成解读" },
    report: { scope: "CN", at: null, missing: "这一天的报告还没有生成", status: { job: "macro.report", status: "failed", error: "模型超时", detail: null } },
    status: {
      expectedSeconds: 180,
      report: { running: false, lastStatus: "failed", lastError: "模型超时", detail: null, startedAt: "2026-11-07T02:30:00.000Z", at: null, writtenAt: null },
      interpretation: { running: false, lastStatus: "failed", lastError: "模型超时", startedAt: "2026-11-07T02:30:00.000Z", generation: 0, at: null },
    },
  },
  {
    name: "生成状态接口返回畸形数据", alloc: allocData, interp: fullInterp, report: fullReport,
    status: { expectedSeconds: null, report: null, interpretation: "坏值" },
  },
  {
    name: "回来时服务端报告已有今日成果（恢复出常驻入口）", alloc: allocData, interp: fullInterp, report: fullReport,
    status: {
      expectedSeconds: 180, today: "2026-11-07",
      report: { running: false, lastStatus: "ok", lastError: null, detail: { written: true, reason: null }, startedAt: "2026-11-07T02:30:00.000Z", at: "2026-11-07", writtenAt: "2026-11-07", hasToday: true },
      interpretation: { running: false, lastStatus: "ok", lastError: null, startedAt: "2026-11-07T02:30:00.000Z", generation: 2, at: "2026-11-07", hasToday: true },
    },
  },
  {
    name: "回来时服务端报告仍在跑但已超 10 分钟（僵尸任务）", alloc: allocData, interp: fullInterp, report: fullReport,
    status: {
      expectedSeconds: 180, today: "2026-11-07",
      report: { running: true, lastStatus: "running", lastError: null, detail: null, startedAt: "2026-11-07T02:30:00.000Z", at: null, writtenAt: null, hasToday: false },
      interpretation: { running: true, lastStatus: "running", lastError: null, startedAt: "2026-11-07T02:30:00.000Z", generation: 0, at: null, hasToday: false },
    },
  },
];

const PAGES = [
  { path: "/dashboard/allocation", marker: "动态组合配置" },
  { path: "/dashboard/report", marker: "每日 PEST 分析" },
  { path: "/dashboard/report?scope=US", marker: "每日 PEST 分析" },
  { path: "/dashboard/allocation/report", marker: "AI 解读报告" },
];

/** 有数据时，页面必须真的把正文和查看入口渲染出来，而不只是返回 200。 */
const CONTENT_CHECKS = [
  { path: "/dashboard/report", when: "完整数据（有报告 + 有解读）", must: ["政治象限", "关注要点", "原始宏观数据快照"] },
  { path: "/dashboard/allocation", when: "完整数据（有报告 + 有解读）", must: ["这是一段 AI 解读正文。", "查看解读报告"] },
  { path: "/dashboard/allocation/report", when: "完整数据（有报告 + 有解读）", must: ["这是一段 AI 解读正文。", "关注 PPI", "返回组合配置"] },
  { path: "/dashboard/allocation/report", when: "还没有任何报告 / 解读", must: ["还没有生成 AI 解读报告", "去组合配置生成"] },
];

// 生成状态接口：前端 hydration / 轮询会读它，同样要覆盖各种形状。
const GENERATION_STATUS = {
  expectedSeconds: 180,
  today: "2026-11-07",
  report: { running: false, lastStatus: "ok", lastError: null, detail: { written: true, reason: null }, startedAt: "2026-11-07T02:30:00.000Z", at: "2026-11-07", writtenAt: "2026-11-07", hasToday: true },
  interpretation: { running: false, lastStatus: "ok", lastError: null, startedAt: "2026-11-07T02:30:00.000Z", generation: 2, at: "2026-11-07", hasToday: true },
};

let scenario = CASES[0];

const apiPort = await freePort();
const webPort = await freePort();

const api = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const body = path === "/api/site/dashboard/allocation" ? scenario.alloc
    : path === "/api/site/dashboard/allocation/interpretation" ? scenario.interp
    : path === "/api/site/dashboard/report" ? scenario.report
    : path === "/api/site/dashboard/generation/status" ? (scenario.status ?? GENERATION_STATUS)
    : { changelogVersion: null };
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
});
await new Promise((resolve) => api.listen(apiPort, "127.0.0.1", resolve));

const web = spawn(process.execPath, ["apps/web/server.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "production", WEB_PORT: String(webPort), WEB_HOST: "127.0.0.1", API_BASE_URL: `http://127.0.0.1:${apiPort}` },
  stdio: ["ignore", "pipe", "pipe"],
});
let webLog = "";
web.stdout.on("data", (d) => { webLog += d; });
web.stderr.on("data", (d) => { webLog += d; });

let failed = 0;
let checked = 0;
try {
  // Wait for the web process to answer at all before starting the matrix.
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { await fetch(`http://127.0.0.1:${webPort}/`); up = true; } catch { /* not up yet */ }
  }
  if (!up) throw new Error(`web server did not start: ${webLog.slice(0, 1500)}`);

  for (const c of CASES) {
    scenario = c;
    for (const page of PAGES) {
      // A fresh query busts the page's 300 s cache so each case really hits the loader.
      const url = `http://127.0.0.1:${webPort}${page.path}${page.path.includes("?") ? "&" : "?"}smoke=${checked}`;
      const res = await fetch(url);
      const html = await res.text();
      const ok = res.status === 200 && html.includes(page.marker) && !html.includes("Internal error");
      checked++;
      if (!ok) failed++;
      console.log(`${ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${c.name} → ${page.path}${ok ? "" : ` (marker=${html.includes(page.marker)})`}`);
    }
  }

  // 内容断言：把 stub 切到指定场景，确认正文与查看入口真的出现在 HTML 里。
  // 必须在 finally 关闭 web 进程之前跑。
  console.log("\n--- content checks ---");
  for (const [i, check] of CONTENT_CHECKS.entries()) {
    scenario = CASES.find((x) => x.name === check.when);
    const url = `http://127.0.0.1:${webPort}${check.path}?content=${i}&n=${checked}`;
    const res = await fetch(url);
    const html = await res.text();
    for (const needle of check.must) {
      const ok = res.status === 200 && html.includes(needle);
      checked++;
      if (!ok) failed++;
      console.log(`${ok ? "ok  " : "FAIL"} ${check.path} contains "${needle}"`);
    }
  }
} catch (error) {
  failed++;
  console.log("FAIL harness:", error.message);
} finally {
  web.kill("SIGTERM");
  api.close();
}

console.log(`\n${checked - failed}/${checked} SSR checks passed`);
if (failed && webLog.trim()) console.log("web log (tail):", webLog.trim().slice(-1500));
process.exit(failed === 0 ? 0 : 1);
