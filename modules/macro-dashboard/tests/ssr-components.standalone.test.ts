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

/** 声明了 application/json 却没有 body 的请求会被 Fastify 判 400，全局错误处理回
 * "The request could not be processed."，按钮看起来就是点了没反应。 */
test("声明 JSON 的 POST/PATCH/PUT/DELETE 都必须带 body", () => {
  for (const file of [
    "modules/macro-dashboard/web/report-now.tsx",
    "modules/macro-dashboard/web/allocation.tsx",
    "apps/web/app/features/admin/action.ts",
  ]) {
    const lines = read(file).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/content-type.*application\/json/.test(lines[i]!)) continue;
      // 同一个 fetch 调用块里，headers 前后 12 行内必须出现 body（或该头是条件追加的）。
      const window = lines.slice(Math.max(0, i - 12), i + 13).join("\n");
      const conditional = /headers\["content-type"\]|body !== undefined/.test(window);
      assert.ok(/\bbody:/.test(window) || conditional,
        `${file}:${i + 1} 声明了 JSON 却没有 body（会 400）`);
    }
  }
});

test("报告页与组合配置页的 loader 都先规范化再交给渲染体", () => {
  const alloc = read("modules/macro-dashboard/web/allocation.tsx");
  const report = read("modules/macro-dashboard/web/report.tsx");
  assert.match(alloc, /safeAllocation\(/, "组合配置 loader 必须收敛配置数据");
  assert.match(alloc, /safeInterpretation\(/, "组合配置 loader 必须收敛解读数据");
  assert.match(report, /safeReport\(/, "报告页 loader 必须收敛报告数据");
  // hydration 后拉取的解读同样要规范化，否则旧数据会在客户端崩。
  assert.ok((alloc.match(/safeInterpretation\(/g) ?? []).length >= 2,
    "hydration / 轮询拿到的解读也必须规范化");
  assert.doesNotMatch(report, /report\.payload\.watchpoints\.length/,
    "渲染体不能再直接对未守卫的 payload 取 length");
  assert.doesNotMatch(alloc, /interpretation\.payload\.snapshot\./,
    "解读快照要统一走带默认值的局部变量");
});
