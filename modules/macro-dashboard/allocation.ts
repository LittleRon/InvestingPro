// 动态组合配置的规则引擎（纯函数、零模型成本）。输入周期位置 + 时钟象限 + 时效范围 +
// 总资产 + 当前持仓，输出各资产大类基线权重 + 金额。规则是一张「时钟象限 → 基础权重」映射表，
// 周期位置和时效范围各做小幅调整，归一化到 100%。AI 只负责写解读，不重算权重。
//
// 方法论：
//   基础权重：从时钟的资产适配分起步（已含象限逻辑），不是另起一套。
//   周期调整：康波/朱格拉/基钦各自 rising/falling 做 ±3% 的战术加减，方向明确、幅度小。
//   时效调整：短期加现金减风险资产，长期减现金加风险资产，反映不同时间窗口的风险承受。
import type { AssetKey, ClockResult } from "./clock.ts";
import { ASSETS } from "./clock.ts";
import type { CycleKey } from "./indicators.ts";

export type Horizon = "short" | "medium" | "long";

export const HORIZONS: readonly { key: Horizon; name: string; months: string }[] = [
  { key: "short", name: "短期", months: "3–6 个月" },
  { key: "medium", name: "中期", months: "6–18 个月" },
  { key: "long", name: "长期", months: "1–3 年+" },
];

export interface AllocationInput {
  clock: ClockResult;
  cycles: { key: CycleKey; phase: "rising" | "falling" | null }[];
  horizon: Horizon;
  totalAssets: number;
  holdings: { stocks: number; bonds: number; commodities: number; cash: number; gold: number };
}

export interface AllocationWeight {
  key: AssetKey;
  name: string;
  /** 归一化后的权重百分比（0–100）。 */
  weight: number;
  /** 建议金额。 */
  amount: number;
  /** 当前持仓金额。 */
  holdings: number;
  /** 建议金额 - 当前持仓（正数=建议加仓，负数=建议减仓）。 */
  diff: number;
}

export interface AllocationResult {
  weights: AllocationWeight[];
  totalAssets: number;
  notes: string[];
}

/** 对分数做小幅加减，下限 5（避免某类资产权重归零）。 */
function adjust(scores: Map<AssetKey, number>, deltas: Partial<Record<AssetKey, number>>): void {
  for (const [key, delta] of Object.entries(deltas) as [AssetKey, number][]) {
    const next = (scores.get(key) ?? 50) + delta;
    scores.set(key, Math.max(5, next));
  }
}

/**
 * 算出配置方案。从时钟资产分起步，周期和时效各做调整，归一化到 100%，算金额和差异。
 */
export function computeAllocation(input: AllocationInput): AllocationResult {
  const { clock, cycles, horizon, totalAssets, holdings } = input;

  // 1. 基础分：从时钟的资产适配分起步。
  const scores = new Map<AssetKey, number>();
  for (const a of clock.assetScores) scores.set(a.key, a.score);

  const notes: string[] = [`基础权重来自投资时钟的 ${clock.quadrantName} 象限资产适配分。`];

  // 2. 周期调整：每个周期的 rising/falling 做小幅战术加减。
  for (const cycle of cycles) {
    if (cycle.phase === "rising") {
      if (cycle.key === "kondratiev") { adjust(scores, { stocks: 3, cash: -3 }); notes.push("康波上升段：股票 +3，现金 -3。"); }
      if (cycle.key === "juglar") { adjust(scores, { stocks: 2, cash: -2 }); notes.push("朱格拉上升段：股票 +2，现金 -2。"); }
      if (cycle.key === "kitchin") { adjust(scores, { commodities: 3, cash: -3 }); notes.push("基钦上升段：大宗商品 +3，现金 -3。"); }
    } else if (cycle.phase === "falling") {
      if (cycle.key === "kondratiev") { adjust(scores, { bonds: 3, stocks: -3 }); notes.push("康波下降段：债券 +3，股票 -3。"); }
      if (cycle.key === "juglar") { adjust(scores, { bonds: 2, stocks: -2 }); notes.push("朱格拉下降段：债券 +2，股票 -2。"); }
      if (cycle.key === "kitchin") { adjust(scores, { cash: 3, commodities: -3 }); notes.push("基钦下降段：现金 +3，大宗商品 -3。"); }
    }
  }

  // 3. 时效调整：短期防御、长期进取。
  if (horizon === "short") {
    adjust(scores, { cash: 10, stocks: -5, commodities: -3, gold: -2 });
    notes.push("短期视角（3–6 月）：现金 +10，股票 -5，大宗商品 -3，黄金 -2。");
  } else if (horizon === "long") {
    adjust(scores, { cash: -8, stocks: 4, commodities: 2, gold: 2 });
    notes.push("长期视角（1–3 年+）：现金 -8，股票 +4，大宗商品 +2，黄金 +2。");
  }

  // 4. 归一化到 100%，算金额和差异。
  const sum = [...scores.values()].reduce((s, v) => s + v, 0) || 1;
  const weights: AllocationWeight[] = ASSETS.map((a) => {
    const score = scores.get(a.key) ?? 50;
    const weight = (score / sum) * 100;
    const amount = (weight / 100) * totalAssets;
    const holding = holdings[a.key];
    return {
      key: a.key,
      name: a.name,
      weight: Math.round(weight * 10) / 10,
      amount: Math.round(amount),
      holdings: holding,
      diff: Math.round(amount - holding),
    };
  });

  return { weights, totalAssets, notes };
}
