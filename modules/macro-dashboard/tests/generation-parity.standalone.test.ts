// AI 解读与 PEST 报告必须「同样处理」：生成入口、进度、状态解释、查看引导、
// 缓存策略、任务记录口径，任何一边单独特例化都算退化。
//
// 这些是源码层的结构约束：纯逻辑单测只能证明某条数据不崩，证明不了两边走的是同一条链路。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const reportPage = () => read("modules/macro-dashboard/web/report.tsx");
const interpPage = () => read("modules/macro-dashboard/web/interpretation-report.tsx");
const button = () => read("modules/macro-dashboard/web/report-now.tsx");
const server = () => read("modules/macro-dashboard/server.ts");

test("两个报告详情页用同一套缓存策略：页面 HTML 不缓存 + hydration 补拉", () => {
  for (const [name, page] of [["PEST", reportPage()], ["AI 解读", interpPage()]] as const) {
    assert.match(page, /cachedPage\(0,/, `${name} 报告页不能缓存 300 秒，否则刚生成的内容看不到`);
    assert.match(page, /cache: "no-store"/, `${name} 报告页 hydration 后要补拉最新数据`);
  }
});

test("两个报告页的空状态都能直接生成，并给出真实原因与进度说明", () => {
  for (const [name, page] of [["PEST", reportPage()], ["AI 解读", interpPage()]] as const) {
    assert.match(page, /<EmptyState/, `${name} 报告页要有空状态`);
    assert.match(page, /explainRunStatus\(/, `${name} 报告页要解释「为什么还没有」`);
    assert.match(page, /预计等待时间和生成进度/, `${name} 空状态要告诉用户会看到进度`);
  }
  assert.match(reportPage(), /<ReportNowButton\b/, "PEST 空状态能直接生成");
  assert.match(interpPage(), /<InterpretationNowButton\b/, "解读空状态也能直接生成，不必跳回组合配置页");
  assert.match(interpPage(), /explainRunStatus\(status, "解读"\)/, "解读侧用自己的措辞解释任务状态");
});

test("状态解释文案只有一份实现，三个页面共用", () => {
  const text = read("modules/macro-dashboard/status-text.ts");
  assert.match(text, /export function explainRunStatus/, "要有共享的解释函数");
  for (const [name, page] of [["PEST 报告页", reportPage()], ["解读报告页", interpPage()], ["仪表盘", read("modules/macro-dashboard/web/dashboard.tsx")]] as const) {
    assert.match(page, /explainRunStatus\(/, `${name} 要用共享解释函数`);
    assert.doesNotMatch(page, /function explain(Report)?Status/, `${name} 不能再自己写一份`);
  }
});

test("两个内容接口都附带任务运行记录，且共用同一个格式化函数", () => {
  const s = server();
  assert.match(s, /async function interpretationRunStatus/, "解读侧要有对等的任务记录查询");
  assert.match(s, /function toRunStatus/, "两种任务记录用同一形状");
  assert.match(s, /safeReport\(.*status/, "PEST 报告接口附 status");
  assert.match(s, /\{ \.\.\.safe, status \}/, "解读内容接口附 status");
  assert.match(s, /detail: interpStatus\?\.detail/, "统一状态接口给解读侧跳过/失败原因");
  assert.match(s, /writtenAt: interp\?\.at/, "统一状态接口给解读侧实际写出的日期");
});

test("通用生成按钮覆盖两种任务，POST 都带 body，查看链接都不带精确日期", () => {
  const b = button();
  assert.match(b, /kind === "report"/, "按 kind 分支，不是两套组件");
  assert.match(b, /\/api\/admin\/macro\/allocation\/interpretation/, "解读的入队地址");
  assert.match(b, /\/api\/admin\/macro\/report\?scope=/, "报告的入队地址");
  assert.match(b, /const postBody = JSON\.stringify\(useForce/, "两种 POST 都必须带 body，否则 Fastify 回 400");
  assert.match(b, /body: postBody,/, "fetch 里确实把 body 传出去");
  assert.doesNotMatch(b, /&at=/, "查看链接不能带精确日期，否则点了落到旧空状态");
  assert.match(b, /export function ReportNowButton/);
  assert.match(b, /export function InterpretationNowButton/);
});

test("PEST 与 AI 解读是两个独立能力，各有自己的模型环境变量", () => {
  const s = server();
  assert.match(s, /pest: \{ label: [^\n]*env: "PEST_MODEL"/, "PEST 用 PEST_MODEL");
  assert.match(s, /allocation_interpretation: \{ label: [^\n]*env: "ALLOCATION_INTERPRETATION_MODEL"/,
    "AI 解读不能误用 PEST_MODEL，否则两者无法分别配置");
  const envs = [...s.matchAll(/env: "([A-Z_]+_MODEL)"/g)].map((m) => m[1]);
  assert.equal(new Set(envs).size, envs.length, "每个能力要有独立的 env 变量");
  const example = read(".env.example");
  assert.match(example, /ALLOCATION_INTERPRETATION_MODEL=/, "配置模板要写明这个变量");
});

test("今天已有成果时，两边的「再写一次 / 重新生成」都真的覆盖当天那一篇", () => {
  const b = button();
  const s = server();
  const rt = read("modules/macro-dashboard/report.ts");
  // 不带 force 时 composeReport / composeInterpretation 会因「今天已有」直接跳过，
  // 用户点完只看到一句跳过原因，感觉像按钮没反应。
  assert.match(b, /const redo = derived\.hasToday/, "按服务端 today 判断，不靠组件本地记忆");
  assert.match(b, /onClick=\{\(\) => submit\(redo\)\}/, "主按钮提交时带上 force");
  assert.match(b, /const postBody = JSON\.stringify\(useForce/, "报告侧也要能发 force");
  assert.match(s, /enqueueReportNow\(scope, body\.force === true\)/, "报告入队接口接受 force");
  assert.match(s, /composeReport\(job\.scope, undefined, force\)/, "报告队列把 force 传给生成函数");
  assert.match(rt, /if \(existing && !force\)/, "报告生成函数支持覆盖");
  assert.match(rt, /ON CONFLICT \(scope, at\) DO UPDATE/, "覆盖时真的更新，而不是 DO NOTHING");
});

test("解读报告页渲染体与 PEST 报告页一样防御式，不直接解引用快照", () => {
  const page = interpPage();
  assert.doesNotMatch(page, /s\.notes\.join\(/, "快照 notes 要带默认值再 join");
  assert.doesNotMatch(page, /p\.watchpoints\.length/, "关注点要带默认值再取 length");
  assert.match(page, /EMPTY_SNAPSHOT/, "缺字段时降级为空快照");
  assert.match(reportPage(), /cachedPage\(0,/, "PEST 也用同一缓存策略");
});
