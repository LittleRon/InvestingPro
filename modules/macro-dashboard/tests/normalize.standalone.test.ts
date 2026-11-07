// SSR 页面不能因为数据库里留着旧格式记录、或接口返回降级响应而在渲染期抛 TypeError。
// 渲染体的输入一律先过这一层：结构不完整就退回空状态，绝不 500。
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAllocation, safeInterpretation, safeReport, safeReportStatus, safeJobDetail } from "../normalize.ts";

const fullReport = {
  scope: "CN", at: "2026-11-07", model: "default",
  payload: {
    political: "P", economic: "E", social: "S", technological: "T",
    watchpoints: ["看 PPI", "看 CPI"], snapshot: "原始快照",
  },
  status: { job: "macro.report", status: "ok", at: "2026-11-07", error: null, detail: { written: true } },
};

const fullInterp = {
  scope: "CN", at: "2026-11-07", model: "default", generation: 2,
  regeneratedAt: "2026-11-07T02:30:00.000Z",
  payload: {
    interpretation: "正文", watchpoints: ["关注一"],
    snapshot: {
      quadrant: "复苏", cycles: "短周期上升", shortWeights: "股票 30%", mediumWeights: "债券 25%",
      longWeights: "黄金 10%", holdings: "股票 40 万", totalAssets: "1000000", notes: ["口径说明"],
    },
  },
};

test("完整报告保留原值，渲染体能安全读 watchpoints.length 与 snapshot", () => {
  const r = safeReport(fullReport);
  assert.equal(r.at, "2026-11-07");
  assert.ok(r.payload);
  assert.equal(r.payload.watchpoints.length, 2);
  assert.equal(r.payload.snapshot, "原始快照");
  assert.equal(r.status?.detail?.written, true);
});

test("报告缺 watchpoints / snapshot 时补齐，不再抛 reading 'length'", () => {
  const r = safeReport({ scope: "CN", at: "2026-11-07", payload: { political: "P" } });
  assert.ok(r.payload, "有 at 且 payload 是对象就给完整结构");
  assert.deepEqual(r.payload.watchpoints, []);
  assert.equal(r.payload.snapshot, "");
  assert.equal(r.payload.economic, "本日无数据");
  assert.doesNotThrow(() => r.payload!.watchpoints.length);
});

test("报告 payload 为 null / 缺失 / 无 at 时一律走空状态", () => {
  for (const raw of [null, undefined, {}, { at: "2026-11-07" }, { at: "2026-11-07", payload: null }, { at: null, payload: fullReport.payload }]) {
    const r = safeReport(raw);
    assert.equal(r.payload, null, `payload 必须为空: ${JSON.stringify(raw)}`);
  }
  assert.match(safeReport({ missing: "还没有" }).missing ?? "", /还没有/);
});

test("报告里非字符串数组、坏时间戳、错误状态都不会漏到渲染体", () => {
  const r = safeReport({
    at: "2026-11-07", payload: { watchpoints: [1, null, "有效", {}], snapshot: 42 },
    status: { job: "macro.report", status: "failed", error: "模型失败", detail: null },
  });
  assert.deepEqual(r.payload!.watchpoints, ["有效"]);
  assert.equal(r.payload!.snapshot, "42");
  assert.equal(r.status?.error, "模型失败");
  // detail 恒为归一化对象（不再透传裸 null），渲染体和状态解释都不用判空。
  assert.equal(r.status?.detail.written, null);
  assert.equal(r.status?.detail.reason, null);
});

test("兼容代理把 JSONB 或旧 content 包装转成字符串的情况", () => {
  const report = safeReport({
    scope: "CN", at: "2026-11-07",
    payload: JSON.stringify({ content: { political: "P", economic: "E" } }),
  });
  assert.equal(report.payload?.political, "P");
  assert.equal(report.payload?.economic, "E");
  const interpretation = safeInterpretation({
    scope: "CN", at: "2026-11-07",
    payload: JSON.stringify({ content: { interpretation: "正文" } }),
  });
  assert.equal(interpretation?.payload.interpretation, "正文");
});

test("完整解读保留原值", () => {
  const i = safeInterpretation(fullInterp);
  assert.ok(i);
  assert.equal(i.generation, 2);
  assert.equal(i.payload.interpretation, "正文");
  assert.equal(i.payload.snapshot.quadrant, "复苏");
  assert.equal(i.payload.snapshot.notes.length, 1);
});

test("解读缺 payload 或正文时返回 null，不会让页面读 undefined.interpretation", () => {
  for (const raw of [
    null, undefined, {}, { missing: "还没有生成解读" },
    { scope: "CN", at: "2026-11-07" },
    { scope: "CN", at: "2026-11-07", payload: null },
    { scope: "CN", at: "2026-11-07", payload: { watchpoints: [] } },
    { ...fullInterp, payload: { ...fullInterp.payload, interpretation: 123 } },
  ]) assert.equal(safeInterpretation(raw), null, `应视为没有解读: ${JSON.stringify(raw)}`);
});

test("解读快照缺字段时全部补齐，渲染体读每一级都安全", () => {
  const i = safeInterpretation({ ...fullInterp, payload: { interpretation: "正文", watchpoints: "不是数组" } });
  assert.ok(i);
  assert.deepEqual(i.payload.watchpoints, []);
  assert.equal(i.payload.snapshot.cycles, "");
  assert.equal(i.payload.snapshot.totalAssets, "");
  assert.deepEqual(i.payload.snapshot.notes, []);
});

test("无效的 regeneratedAt 被丢弃，new Date(...).toLocaleString 不会抛 RangeError", () => {
  const i = safeInterpretation({ ...fullInterp, regeneratedAt: "不是时间" });
  assert.ok(i);
  assert.equal(i.regeneratedAt, null);
  assert.doesNotThrow(() => { if (i!.regeneratedAt) new Date(i!.regeneratedAt).toLocaleString("zh-CN"); });
});

test("组合配置任何畸形输入都给完整结构，渲染体的 map/find 不会崩", () => {
  for (const raw of [null, undefined, {}, { clock: null }, { allocation: null }, { horizons: "坏值" }]) {
    const d = safeAllocation(raw);
    assert.ok(Array.isArray(d.allocation.weights));
    assert.ok(Array.isArray(d.allocation.notes));
    assert.ok(Array.isArray(d.cycles));
    assert.equal(d.clock.quadrantName, "暂无数据");
    for (const key of ["short", "medium", "long"]) {
      assert.ok(Array.isArray(d.horizons[key]!.weights), `${key} 视图必须有 weights`);
    }
    assert.doesNotThrow(() => {
      d.allocation.weights.find((w) => w.key === "stocks");
      d.horizons.short!.weights.map((w) => w.weight.toFixed(1));
      d.allocation.notes.map((n) => n);
    });
  }
});

test("任务 detail 归一化：队列任务的数组与定时任务的对象都能读出 written/reason", () => {
  // recordRun 对队列任务存的是数组（ReportNowRun[]），定时任务是对象。
  // 之前页面把数组当对象读，误报「上次任务跑过了，但没有写出报告」。
  const fromArray = safeJobDetail([{ scope: "CN", collected: 42, written: true }]);
  assert.equal(fromArray.written, true);
  assert.equal(fromArray.collected, 42);
  const fromObject = safeJobDetail({ collected: 7, written: false, reason: "只有 3 项数据，不够写报告" });
  assert.equal(fromObject.written, false);
  assert.equal(fromObject.reason, "只有 3 项数据，不够写报告");
  for (const raw of [null, undefined, [], {}, "坏值", [{ written: "yes" }]]) {
    assert.equal(safeJobDetail(raw).written, null, `畸形 detail 不应被当成成功: ${JSON.stringify(raw)}`);
  }
  assert.equal(safeJobDetail([{ generation: 3 }]).generation, 3);
});

test("报告状态带归一化 detail 与 startedAt，页面能说人话", () => {
  const r = safeReport({
    scope: "CN", at: null,
    status: {
      job: "macro.report-now", status: "ok", at: "2026-11-07", error: null,
      detail: [{ written: true, reason: null }], startedAt: "2026-11-07T02:30:00.000Z",
    },
  });
  assert.equal(r.status?.detail.written, true, "数组 detail 必须被归一化成对象");
  assert.equal(r.status?.startedAt, "2026-11-07T02:30:00.000Z");
  const skipped = safeReport({
    scope: "CN", at: null,
    status: { job: "macro.report", status: "ok", detail: { written: false, reason: "只有 3 项数据，不够写报告" } },
  });
  assert.equal(skipped.status?.detail.reason, "只有 3 项数据，不够写报告");
  assert.equal(skipped.status?.startedAt, null);
});

test("解读与报告共用同一个任务记录形状：detail 是数组也能读出跳过原因", () => {
  const s = safeReportStatus({
    job: "macro.interp", status: "ok", at: "2026-11-07", error: null,
    detail: [{ written: false, reason: "今天已经有解读了", generation: 2 }],
    startedAt: "2026-11-07T02:30:00.000Z",
  });
  assert.equal(s?.job, "macro.interp");
  assert.equal(s?.detail.written, false);
  assert.equal(s?.detail.reason, "今天已经有解读了");
  assert.equal(s?.detail.generation, 2);
  assert.equal(s?.startedAt, "2026-11-07T02:30:00.000Z");
});

test("任务记录缺失或畸形时返回 null，空状态不会误报", () => {
  assert.equal(safeReportStatus(null), null);
  assert.equal(safeReportStatus("坏值"), null);
  assert.equal(safeReportStatus({ detail: {} }), null);
  const s = safeReportStatus({ status: "failed", error: "模型超时", startedAt: "不是时间" });
  assert.equal(s?.status, "failed");
  assert.equal(s?.error, "模型超时");
  assert.equal(s?.startedAt, null, "非法时间不能交给倒计时");
});

test("组合配置正常数据保留权重数值", () => {
  const d = safeAllocation({
    clock: { quadrantName: "过热" },
    cycles: [{ key: "kondratiev", phase: "rising" }],
    allocation: { weights: [{ key: "stocks", name: "股票", weight: 30.5, amount: 305000, holdings: 300000, diff: 5000 }], totalAssets: 1000000, notes: ["口径"] },
    horizons: { short: { weights: [{ key: "stocks", name: "股票", weight: 31, amount: 0, holdings: 0, diff: 0 }], totalAssets: 1000000, notes: [] } },
  });
  assert.equal(d.clock.quadrantName, "过热");
  assert.equal(d.allocation.weights[0]!.weight, 30.5);
  assert.equal(d.horizons.short!.weights[0]!.weight, 31);
  // 缺的视图用当前配置兜底，不会是 undefined
  assert.equal(d.horizons.medium!.weights.length, 1);
});
