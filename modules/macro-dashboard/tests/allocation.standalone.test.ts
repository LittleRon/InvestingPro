// 动态配置规则引擎的测试（不需要数据库）。重点是：权重归一化到 100%、金额与总资产一致、
// 周期/时效调整的方向正确、空输入不报错。
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAllocation, type AllocationInput, type Horizon } from "../allocation.ts";
import type { ClockResult } from "../clock.ts";

/** 构造一个默认的时钟结果（复苏象限，股票分最高）。 */
function defaultClock(): ClockResult {
  return {
    growth: { trend: 2.0, value: 52, at: "2024-06-01", label: "高于荣枯" },
    inflation: { value: 0.3, ppi: -0.5, cpi: 1.5, at: "2024-06-01", label: "低通胀" },
    quadrant: "recovery",
    quadrantName: "复苏",
    assetScores: [
      { key: "stocks", name: "股票", score: 85 },
      { key: "bonds", name: "债券", score: 60 },
      { key: "commodities", name: "大宗商品", score: 45 },
      { key: "cash", name: "现金", score: 35 },
      { key: "gold", name: "黄金", score: 45 },
    ],
    policy: {
      monetary: { score: 70, label: "偏松", value: 9, at: "2024-06-01" },
      fiscal: { score: 50, label: "中性", note: "数据暂缺", value: null, at: null },
    },
    doDont: { do: [], dont: [] },
    notes: [],
  };
}

function defaultInput(horizon: Horizon = "medium"): AllocationInput {
  return {
    clock: defaultClock(),
    cycles: [],
    horizon,
    totalAssets: 1000000,
    holdings: { stocks: 400000, bonds: 200000, commodities: 100000, cash: 200000, gold: 100000 },
  };
}

test("权重归一化到 100%", () => {
  const res = computeAllocation(defaultInput());
  const sum = res.weights.reduce((s, w) => s + w.weight, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, `权重合计 ${sum} 应接近 100`);
});

test("金额合计等于总资产", () => {
  const res = computeAllocation(defaultInput());
  const sum = res.weights.reduce((s, w) => s + w.amount, 0);
  assert.ok(Math.abs(sum - 1000000) < 5000, `金额合计 ${sum} 应接近 100 万`);
});

test("diff = 建议金额 - 当前持仓", () => {
  const res = computeAllocation(defaultInput());
  for (const w of res.weights) {
    assert.ok(Math.abs(w.diff - (w.amount - w.holdings)) < 1, `${w.name} diff ${w.diff} 应等于 ${w.amount} - ${w.holdings}`);
  }
});

test("复苏象限 + 短期：股票权重最高但现金权重比长期高", () => {
  const short = computeAllocation(defaultInput("short"));
  const long = computeAllocation(defaultInput("long"));
  const shortStocks = short.weights.find((w) => w.key === "stocks")!.weight;
  const longStocks = long.weights.find((w) => w.key === "stocks")!.weight;
  const shortCash = short.weights.find((w) => w.key === "cash")!.weight;
  const longCash = long.weights.find((w) => w.key === "cash")!.weight;
  assert.ok(shortStocks > longStocks - 5, "短期股票权重不应比长期低太多");
  assert.ok(shortCash > longCash, `短期现金 ${shortCash} 应高于长期 ${longCash}`);
});

test("康波上升段：股票权重提高", () => {
  const base = computeAllocation(defaultInput());
  const withCycle = computeAllocation({
    ...defaultInput(),
    cycles: [{ key: "kondratiev", phase: "rising" }],
  });
  const baseStocks = base.weights.find((w) => w.key === "stocks")!.weight;
  const cycleStocks = withCycle.weights.find((w) => w.key === "stocks")!.weight;
  assert.ok(cycleStocks > baseStocks, `康波上升段股票 ${cycleStocks} 应高于基准 ${baseStocks}`);
});

test("基钦下降段：大宗商品权重降低", () => {
  const base = computeAllocation(defaultInput());
  const withCycle = computeAllocation({
    ...defaultInput(),
    cycles: [{ key: "kitchin", phase: "falling" }],
  });
  const baseCommod = base.weights.find((w) => w.key === "commodities")!.weight;
  const cycleCommod = withCycle.weights.find((w) => w.key === "commodities")!.weight;
  assert.ok(cycleCommod < baseCommod, `基钦下降段大宗商品 ${cycleCommod} 应低于基准 ${baseCommod}`);
});

test("空周期输入不报错", () => {
  const res = computeAllocation(defaultInput());
  assert.equal(res.weights.length, 5);
  assert.ok(res.notes.length > 0);
});

test("所有资产权重 >= 5（不归零）", () => {
  const res = computeAllocation({
    ...defaultInput(),
    horizon: "short",
    cycles: [
      { key: "kondratiev", phase: "falling" },
      { key: "juglar", phase: "falling" },
      { key: "kitchin", phase: "falling" },
    ],
  });
  for (const w of res.weights) {
    assert.ok(w.weight >= 0, `${w.name} 权重 ${w.weight} 不应为负`);
  }
});
