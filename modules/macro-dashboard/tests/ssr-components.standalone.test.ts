// 这个站点是 SSR 的（react-router.config.ts: ssr: true）。页面组件在服务端渲染时没有
// window/document，渲染体里读一次就是整页 500；站内跳转走客户端渲染却一切正常，
// 所以这类 bug 只在「刷新 / 直接打开链接」时暴露，最容易漏。
//
// 这一组测试是源码层的护栏：地址一律由 useLocation() 提供，公开的登录回跳链接
// 不能用 window.location 拼；「检查登录状态」必须有出口，否则管理员的按钮永远置灰。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** 所有会被服务端渲染的组件文件；entry.client.tsx 只在浏览器里跑，排除。 */
function serverComponents(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".tsx") && entry.name !== "entry.client.tsx") out.push(rel);
    }
  };
  walk("apps/web/app");
  walk("modules");
  return out;
}

// tsx 里的浏览器全局读取：事件处理器、useEffect 回调里是安全的，渲染体里不是。
// 下面两条只约束「读地址」这个确切形态——地址在 SSR 下必须来自 router，无论在哪都不能读 window。
const READS_WINDOW_ADDRESS = /window\.location\.(pathname|search|origin|hash|host)\b/;
const INTERPOLATES_WINDOW_ADDRESS = /\$\{[^}]*window\.location\./;

test("服务端渲染的组件不从 window.location 读地址", () => {
  for (const file of serverComponents()) {
    const text = read(file);
    const offenders = text.split("\n")
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text: line }) => READS_WINDOW_ADDRESS.test(line) || INTERPOLATES_WINDOW_ADDRESS.test(line));
    assert.deepEqual(offenders, [], `${file}: 地址要用 useLocation()，读 window.location 会让 SSR 整页 500`);
  }
});

test("组合配置页和报告按钮的登录回跳链接走 useLocation", () => {
  for (const file of [
    "modules/macro-dashboard/web/allocation.tsx",
    "modules/macro-dashboard/web/report-now.tsx",
  ]) {
    const text = read(file);
    assert.match(text, /useLocation\(\)/, `${file}: 必须从 router 拿当前地址`);
    assert.match(text, /import\s*\{[^}]*useLocation[^}]*\}\s*from\s*"react-router"/, `${file}: 少了 useLocation 的 import`);
    assert.match(text, /loginLink/, `${file}: 登录链接应复用同一份地址`);
    // window.location.reload() 在事件回调里是安全的；只有「读地址」会在 SSR 时炸。
    assert.doesNotMatch(text, READS_WINDOW_ADDRESS, `${file}: 渲染时读 window 地址会 500`);
  }
});

test("「检查登录状态」在登录成功后会离开，按钮不会永远置灰", () => {
  const text = read("modules/macro-dashboard/web/report-now.tsx");
  assert.match(text, /useState<Phase>\("checking"\)/, "初始状态是检查中");
  assert.match(text, /"ready"/, "Phase 需要一个登录成功后的状态");
  // 成功分支：拿到 me 之后必须 setPhase，否则 phase 永远停在 checking。
  assert.match(text, /res\.json\(\) as AdminMe;[\s\S]{0,240}setPhase\("ready"\)/,
    "/api/admin/me 返回 200 后必须切到 ready");
  assert.match(text, /phase === "checking"[^\n]*disabled/, "checking 时按钮确实置灰");
});
