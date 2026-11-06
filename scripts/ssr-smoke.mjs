// One-off SSR smoke check: serves fake api data, starts the built web server, and requests the
// allocation page the same way a browser reload does (server-rendered, no browser globals).
//
//   npm run build -w @aihot/web && node scripts/ssr-smoke.mjs
//
// A page that only works after a client-side navigation but 500s on a hard reload is exactly what
// this catches: on the server there is no `window`, so any render-time read of it fails the page.
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
const payload = {
  clock: { quadrantName: "复苏", growth: { trend: 1, value: 50, at: null, label: "回升" }, inflation: { value: 2, ppi: null, cpi: 2, at: null, label: "温和" } },
  cycles: [], allocation, horizons,
};

const apiPort = await freePort();
const webPort = await freePort();

const api = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const body = path === "/api/site/dashboard/allocation" ? payload
    : path === "/api/site/dashboard/allocation/interpretation" ? { missing: "还没有生成解读" }
    : { changelogVersion: null };
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
});

await new Promise((resolve) => api.listen(apiPort, "127.0.0.1", resolve));

const web = spawn(process.execPath, ["apps/web/server.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    WEB_PORT: String(webPort),
    WEB_HOST: "127.0.0.1",
    API_BASE_URL: `http://127.0.0.1:${apiPort}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let webLog = "";
web.stdout.on("data", (d) => { webLog += d; });
web.stderr.on("data", (d) => { webLog += d; });

let status = 0;
let html = "";
try {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${webPort}/dashboard/allocation`);
      status = res.status;
      html = await res.text();
      break;
    } catch { /* web not up yet */ }
  }
} finally {
  web.kill("SIGTERM");
  api.close();
}

const ok = status === 200 && html.includes("动态组合配置") && html.includes("/api/auth/login?return=");
console.log(`SSR /dashboard/allocation => ${status}`);
console.log("contains page title:", html.includes("动态组合配置"));
console.log("contains login link:", html.includes("/api/auth/login?return="));
if (!ok && webLog.trim()) console.log("web log:", webLog.trim().slice(0, 1500));
process.exit(ok ? 0 : 1);
