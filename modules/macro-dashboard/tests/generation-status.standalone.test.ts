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
    at: "2026-11-07", hasToday: true, detail: { written: true, reason: null }, writtenAt: "2026-11-07",
  },
  interpretation: {
    running: false, lastStatus: "ok", lastError: null, startedAt: "2026-11-07T02:30:00.000Z",
    generation: 2, at: "2026-11-07", hasToday: true,
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

test("两个页面都用服务端 hook，不再把进度存在组件本地 state", () => {
  const btn = read("modules/macro-dashboard/web/report-now.tsx");
  const alloc = read("modules/macro-dashboard/web/allocation.tsx");
  assert.match(btn, /useGenerationStatus\("report"/, "报告按钮要跟服务端状态同步");
  assert.match(alloc, /useGenerationStatus\("interpretation"/, "AI 解读要跟服务端状态同步");
  assert.doesNotMatch(btn, /pollUntilWritten/, "不再有页面内的本地轮询循环");
  assert.doesNotMatch(alloc, /pollForNewInterp/, "不再有页面内的本地轮询循环");
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
