// 生成状态必须以服务端为准：用户跳到别的页面再回来、刷新、换设备打开，
// 都要看到同一个真实进度与结果，不能依赖组件本地 state。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { phaseFromStatus, interpWritten, type GenerationStatus } from "../web/use-generation-status.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const status = (over: Partial<GenerationStatus> = {}): GenerationStatus => ({
  expectedSeconds: 180,
  today: "2026-11-07",
  report: {
    running: false, lastStatus: "ok", lastError: null, startedAt: "2026-11-07T02:30:00.000Z",
    at: "2026-11-07", hasToday: true,
    detail: { written: true, reason: null, collected: null, generation: null }, writtenAt: "2026-11-07",
  },
  interpretation: {
    running: false, lastStatus: "ok", lastError: null, startedAt: "2026-11-07T02:30:00.000Z",
    generation: 2, at: "2026-11-07", hasToday: true,
    detail: { written: true, reason: null, collected: null, generation: null }, writtenAt: "2026-11-07",
  },
  ...over,
});

test("页面加载时从服务端状态恢复：今天已有报告就给查看入口，不需要原地等", () => {
  const d = phaseFromStatus(status(), "report");
  assert.equal(d.phase, "done");
  assert.equal(d.hasToday, true);
  assert.equal(d.startedAt, Date.parse("2026-11-07T02:30:00.000Z"));
  assert.match(d.message, /可以/);
});

test("任务进行中：恢复成 running，并把服务端开始时间交给倒计时", () => {
  const d = phaseFromStatus(status({
    report: { ...status().report, running: true, lastStatus: "running", hasToday: false, at: null, writtenAt: null },
  }), "report");
  assert.equal(d.phase, "running");
  assert.equal(d.startedAt, Date.parse("2026-11-07T02:30:00.000Z"));
  assert.match(d.message, /先去做别的事|自动更新/);
});

test("任务失败：恢复成 failed 并带上服务端错误原因", () => {
  const d = phaseFromStatus(status({
    report: { ...status().report, running: false, lastStatus: "failed", lastError: "模型超时\n堆栈", hasToday: false },
  }), "report");
  assert.equal(d.phase, "failed");
  assert.equal(d.message, "模型超时");
});

test("从未跑过任务：安静的 idle，不显示假完成", () => {
  assert.equal(phaseFromStatus(null, "report").phase, "idle");
  const d = phaseFromStatus(status({
    report: { ...status().report, lastStatus: null, hasToday: false, at: null, startedAt: null },
  }), "report");
  assert.equal(d.phase, "idle");
  assert.equal(d.startedAt, null);
});

test("坏掉的时间戳不会让倒计时算出 NaN", () => {
  const d = phaseFromStatus(status({
    report: { ...status().report, running: true, startedAt: "不是时间" },
  }), "report");
  assert.equal(d.startedAt, null);
});

test("解读 generation 变大或今天已有，都说明写出了新的正文", () => {
  assert.equal(interpWritten(status(), 1), true);
  assert.equal(interpWritten(status(), 2), true, "generation 相同时，hasToday 也要算已写出");
  assert.equal(interpWritten(null, 0), false);
});

test("报告与解读共用同一个生成按钮，状态只由服务端驱动", () => {
  const btn = read("modules/macro-dashboard/web/report-now.tsx");
  const alloc = read("modules/macro-dashboard/web/allocation.tsx");
  const interp = read("modules/macro-dashboard/web/interpretation-report.tsx");
  const report = read("modules/macro-dashboard/web/report.tsx");
  assert.match(btn, /kind: GenerationKind/, "同一组件覆盖报告与解读两种任务");
  assert.match(btn, /useGenerationStatus\(kind/, "统一轮询服务端状态");
  assert.match(btn, /export function ReportNowButton/);
  assert.match(btn, /export function InterpretationNowButton/);
  assert.match(report, /<ReportNowButton\b/, "PEST 报告页能直接生成");
  assert.match(alloc, /<InterpretationNowButton\b/, "组合配置页用同一个按钮");
  assert.match(interp, /<InterpretationNowButton\b/, "解读报告页也能直接生成");
  assert.doesNotMatch(btn, /pollUntilWritten/, "不再有页面内的本地轮询循环");
  assert.doesNotMatch(alloc, /pollForNewInterp|handleInterp/, "解读侧不再有第二套实现");
});

test("查看报告链接不带精确日期，且用普通链接整页跳转", () => {
  const btn = read("modules/macro-dashboard/web/report-now.tsx");
  const progress = read("modules/macro-dashboard/web/generation-progress.tsx");
  // 带 &at= 会按某一天精确查库，日期不一致就落到「还没有这一天的报告」。
  assert.doesNotMatch(btn, /viewHref.*&at=/, "查看链接不能带精确日期参数");
  assert.match(btn, /viewHref = `\/dashboard\/report\?scope=/, "按最新一篇报告查看");
  // IntentLink 的 prefetch / 页面复用缓存会让动态插入的查看按钮看起来点不动。
  assert.doesNotMatch(progress, /IntentLink/, "完成提示里的查看入口要用普通链接");
  assert.match(progress, /<a href=\{view\.href\}/, "完成提示的查看入口");
  assert.match(progress, /<a href=\{readyView\.href\}/, "回来时的常驻查看入口");
});

test("服务端状态接口有僵尸 running 超时保护与今日标记", () => {
  const server = read("modules/macro-dashboard/server.ts");
  assert.match(server, /STALE_MS/, "崩溃残留的 running 记录不能让进度条永远转");
  assert.match(server, /hasToday: report\?\.at === today/, "报告要告诉页面今天是否已有");
  assert.match(server, /hasToday: interp\?\.at === today/, "解读要告诉页面今天是否已有");
});

test("报告与解读的任务记录走同一个格式化函数，字段完全对等", () => {
  const server = read("modules/macro-dashboard/server.ts");
  assert.match(server, /function toRunStatus/, "两种任务的 detail / startedAt 口径要一致");
  assert.match(server, /async function interpretationRunStatus/, "解读也有对等的任务记录查询");
  assert.match(server, /detail: interpStatus\?\.detail/, "统一状态接口要给解读侧失败/跳过原因");
  assert.match(server, /writtenAt: interp\?\.at/, "解读侧也要给出实际写出的日期");
  assert.match(server, /\{ \.\.\.safe, status \}/, "解读内容接口和报告接口一样附带任务记录");
});
