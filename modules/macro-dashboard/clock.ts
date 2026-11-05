// 美林投资时钟（中国综合版）的算法。经典时钟是「经济增长 × 通胀」的四象限，直接套美国的轴
// 会失真——中国 GDP 增速中枢 4–5%（美国 2–3%），CPI 多年低位、波动小，而且政策对经济权重远
// 高于美国。所以这里做中国化：
//
//   增长轴：制造业 PMI 趋势。PMI 是月度、及时（比年度 GDP 快得多），50 是荣枯线。趋势用近 6
//     个月均值减 50，得到「高/低增长」。
//   通胀轴：PPI 与 CPI 的加权（PPI 反映工业景气、波动大；CPI 反映居民体感、波动小）。
//     通胀是同比，直接用。
//   政策维度：货币政策看 M0 同比，财政政策看财政收入同比（收入高增=财政空间大、支出倾向积极）。
//     东财没有独立的财政支出月度页面，收入同比是方向性代理，页面标注。
//
// 四象限的资产画像不是二值的（非复苏即过热），而是四个「理想点画像」做重心插值：把当前位置
// 当作四个角的加权平均，权重按到各角的距离反比。这样边界上的资产分平滑变化，不会在象限切换
// 时跳跃。输出各资产大类的阶段适配分（0–100）和「该做/不该做」清单（每条带分）。
//
// 这一层是纯函数、零模型成本：给定序列算出确定结果，可复现、可审计。
import type { Point } from "./logic.ts";

/** 四个象限。 */
export type Quadrant = "recovery" | "overheat" | "stagflation" | "recession";

export const QUADRANTS: readonly { key: Quadrant; name: string }[] = [
  { key: "recovery", name: "复苏" },
  { key: "overheat", name: "过热" },
  { key: "stagflation", name: "滞胀" },
  { key: "recession", name: "衰退" },
];

/** 资产大类。 */
export type AssetKey = "stocks" | "bonds" | "commodities" | "cash" | "gold";

export const ASSETS: readonly { key: AssetKey; name: string }[] = [
  { key: "stocks", name: "股票" },
  { key: "bonds", name: "债券" },
  { key: "commodities", name: "大宗商品" },
  { key: "cash", name: "现金" },
  { key: "gold", name: "黄金" },
];

/** 一个象限的理想画像：坐标（单位圆上的角）+ 资产适配分（0–100）。 */
interface Archetype {
  key: Quadrant;
  name: string;
  x: number;
  y: number;
  assets: { stocks: number; bonds: number; commodities: number; cash: number; gold: number };
}

/**
 * 四个理想点放在单位圆的四个角：复苏（高增长、低通胀）在右下，过热（双高）在右上，
 * 滞胀（低增长、高通胀）在左上，衰退（双低）在左下。资产分是中国语境下的阶段偏好。
 */
const ARCHETYPES: readonly Archetype[] = [
  { key: "recovery", name: "复苏", x: 0.7071, y: -0.7071,
    assets: { stocks: 85, bonds: 60, commodities: 45, cash: 35, gold: 45 } },
  { key: "overheat", name: "过热", x: 0.7071, y: 0.7071,
    assets: { stocks: 55, bonds: 30, commodities: 80, cash: 30, gold: 55 } },
  { key: "stagflation", name: "滞胀", x: -0.7071, y: 0.7071,
    assets: { stocks: 30, bonds: 45, commodities: 50, cash: 70, gold: 80 } },
  { key: "recession", name: "衰退", x: -0.7071, y: -0.7071,
    assets: { stocks: 45, bonds: 85, commodities: 35, cash: 50, gold: 55 } },
];

/** 通胀轴里 PPI 的权重，其余归 CPI。两者波动幅度不同，PPI 更敏感，给更高权重。 */
export const PPI_WEIGHT = 0.6;
export const CPI_WEIGHT = 0.4;

/** 通胀轴的高/低分界：加权同比超过这个值算「高通胀」。中国语境下 PPI/CPI 常年在这个值上下。 */
export const INFLATION_MID = 1.0;

/** 货币政策看 M0 同比：高于这个值算宽松，低于这个值算收紧。中国 M0 同比近年大致 6%–13%。 */
export const M0_LOOSE = 10;
export const M0_TIGHT = 6;

/** 增长趋势的均值窗口（月）。 */
export const TREND_MONTHS = 6;

/**
 * 增长趋势：近 N 个月的 PMI 均值减荣枯线 50。返回百分点，正值=高于荣枯（高增长），
 * 负值=低于荣枯（低增长）。序列不足时用现有的全部。
 */
export function growthTrend(pmi: Point[], months = TREND_MONTHS): number {
  const vals = pmi.filter((p) => Number.isFinite(p.value)).map((p) => p.value);
  if (!vals.length) return NaN;
  const slice = vals.slice(-Math.min(months, vals.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length - 50;
}

/** 通胀轴：PPI×PPI_WEIGHT + CPI×CPI_WEIGHT。缺的那一项按 0 计（中性），不伪造。 */
export function inflationAxis(ppi: number | null, cpi: number | null): number {
  const ppiV = Number.isFinite(ppi ?? NaN) ? ppi! : 0;
  const cpiV = Number.isFinite(cpi ?? NaN) ? cpi! : 0;
  return ppiV * PPI_WEIGHT + cpiV * CPI_WEIGHT;
}

/** 一条序列的最后一个值（NaN/空序列返回 null）。 */
function last(points: Point[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i]!.value;
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/** 货币政策松紧：M0 同比线性映射到 0–100，越高越松。没有 M0 时返回中性 50。 */
export function monetaryStance(m0: number | null): { score: number; label: string } {
  if (m0 === null || !Number.isFinite(m0)) return { score: 50, label: "中性（数据不足）" };
  const span = M0_LOOSE - M0_TIGHT;
  const score = Math.max(0, Math.min(100, ((m0 - M0_TIGHT) / span) * 100));
  const label = score >= 75 ? "宽松" : score >= 40 ? "偏松" : score >= 25 ? "中性偏紧" : "收紧";
  return { score, label };
}

/**
 * 财政政策松紧：财政收入同比线性映射到 0–100，越高越松（收入高增=财政空间大、支出倾向积极）。
 * 没有数据时返回中性 50。这是方向性代理，不是精确的财政力度测量。
 */
export function fiscalStance(fiscalRevenue: number | null): { score: number; label: string } {
  if (fiscalRevenue === null || !Number.isFinite(fiscalRevenue)) return { score: 50, label: "中性（数据不足）" };
  // 财政收入同比 >8% 算积极，<0% 算收缩，中间线性映射
  const span = 8 - 0;
  const score = Math.max(0, Math.min(100, ((fiscalRevenue - 0) / span) * 100));
  const label = score >= 75 ? "积极" : score >= 40 ? "偏积极" : score >= 25 ? "中性偏紧" : "收缩";
  return { score, label };
}

export interface ClockPolicy {
  monetary: { score: number; label: string; value: number | null; at: string | null };
  fiscal: { score: number; label: string; note: string; value: number | null; at: string | null };
}

export interface ClockDoDont {
  do: { asset: AssetKey; name: string; score: number }[];
  dont: { asset: AssetKey; name: string; score: number }[];
}

export interface ClockResult {
  growth: { trend: number; value: number | null; at: string | null; label: string };
  inflation: { value: number; ppi: number | null; cpi: number | null; at: string | null; label: string };
  quadrant: Quadrant;
  quadrantName: string;
  /** 各资产大类阶段适配分（0–100），未排序。 */
  assetScores: { key: AssetKey; name: string; score: number }[];
  policy: ClockPolicy;
  doDont: ClockDoDont;
  /** 算法的口径与局限，给页面标注。 */
  notes: string[];
}

/** 增长/通胀坐标到单位圆上的缩放阈值：PMI 趋势 ±4 个百分点、通胀 ±6 个百分点映射到 ±0.7071。 */
const GROWTH_FULL = 4;
const INFL_FULL = 6;

/**
 * 算出一个时钟读数。输入各序列（PMI/PPI/CPI/M0，月度同比或指数），输出象限、资产分、政策、清单。
 * 序列为空或缺值时对应项按中性处理，并在 notes 里写清，不伪造。
 */
export function computeClock(input: {
  pmi: Point[];
  ppi: Point[];
  cpi: Point[];
  m0: Point[];
  fiscalRevenue?: Point[];
}): ClockResult {
  const { pmi, ppi, cpi, m0, fiscalRevenue = [] } = input;

  const trend = growthTrend(pmi);
  const ppiV = last(ppi);
  const cpiV = last(cpi);
  const inflation = inflationAxis(ppiV, cpiV);
  const m0V = last(m0);

  // 坐标归一到单位圆：x = 增长方向，y = 通胀方向。
  const cx = (trend / GROWTH_FULL) * 0.7071;
  const cy = (inflation / INFL_FULL) * 0.7071;
  const norm = Math.hypot(cx, cy) || 1e-9;
  const ux = cx / norm;
  const uy = cy / norm;

  // 重心插值：到四个理想点的距离反比（平方反比）加权，边界上平滑变化，不跳跃。
  const dists = ARCHETYPES.map((a) => Math.hypot(ux - a.x, uy - a.y));
  const weights = dists.map((d) => (d > 1e-9 ? 1 / (d * d) : 0));
  const sumInv = weights.reduce((s, w) => s + w, 0) || 1;
  const ws = weights.map((w) => w / sumInv);

  const scores: Record<AssetKey, number> = { stocks: 0, bonds: 0, commodities: 0, cash: 0, gold: 0 };
  for (let i = 0; i < ARCHETYPES.length; i++) {
    const a = ARCHETYPES[i]!;
    const w = ws[i]!;
    for (const key of Object.keys(scores) as AssetKey[]) scores[key] += w * a.assets[key];
  }

  // 主象限 = 重心权重最高的那一格。
  let nearestIdx = 0;
  for (let i = 1; i < ARCHETYPES.length; i++) if (ws[i]! > ws[nearestIdx]!) nearestIdx = i;
  const nearest = ARCHETYPES[nearestIdx]!;

  const assetScores = ASSETS.map((a) => ({ key: a.key, name: a.name, score: Math.round(scores[a.key] * 10) / 10 }));
  const sorted = [...assetScores].sort((a, b) => b.score - a.score);
  const doDont: ClockDoDont = {
    do: sorted.slice(0, 2).map((s) => ({ asset: s.key, name: s.name, score: s.score })),
    dont: [...sorted].reverse().slice(0, 2).map((s) => ({ asset: s.key, name: s.name, score: s.score })),
  };

  const monetary = monetaryStance(m0V);
  const fiscalV = last(fiscalRevenue);
  const fiscal = fiscalStance(fiscalV);
  const growthLabel = !Number.isFinite(trend) ? "数据不足" : trend > 0 ? "高于荣枯（高增长）" : "低于荣枯（低增长）";
  const inflationLabel = !Number.isFinite(inflation) ? "数据不足" : inflation > INFLATION_MID ? "高通胀" : "低通胀";

  const notes = [
    "增长轴用制造业 PMI 近 6 个月均值（50 为荣枯线），比年度 GDP 及时；通胀轴 = PPI×0.6 + CPI×0.4。",
    "四象限资产画像是四个理想点的重心插值，边界上平滑变化，不是非此即彼。",
    "货币政策看 M0 同比；财政维度用财政收入同比做方向性代理（收入高增=财政空间大、支出倾向积极）。",
    "财政维度是方向性代理，不是精确的财政力度测量；缺口在 notes 里标注。",
  ];
  if (!pmi.length) notes.push("增长：没有 PMI 数据，按中性处理。");
  if (!ppi.length && !cpi.length) notes.push("通胀：没有 PPI/CPI 数据，按中性处理。");
  if (!m0.length) notes.push("货币政策：没有 M0 数据，按中性处理。");
  if (!fiscalRevenue.length) notes.push("财政政策：没有财政数据，按中性处理。");

  return {
    growth: { trend: Number.isFinite(trend) ? Math.round(trend * 100) / 100 : NaN, value: last(pmi), at: pmi.length ? pmi[pmi.length - 1]!.at : null, label: growthLabel },
    inflation: { value: Math.round(inflation * 100) / 100, ppi: ppiV, cpi: cpiV, at: ppi.length ? ppi[ppi.length - 1]!.at : (cpi.length ? cpi[cpi.length - 1]!.at : null), label: inflationLabel },
    quadrant: nearest.key,
    quadrantName: nearest.name,
    assetScores,
    policy: {
      monetary: { score: Math.round(monetary.score), label: monetary.label, value: m0V, at: m0.length ? m0[m0.length - 1]!.at : null },
      fiscal: { score: Math.round(fiscal.score), label: fiscal.label, note: fiscalRevenue.length ? "财政维度用财政收入同比做方向性代理" : "财政维度数据暂缺，按中性处理", value: fiscalV, at: fiscalRevenue.length ? fiscalRevenue[fiscalRevenue.length - 1]!.at : null },
    },
    doDont,
    notes,
  };
}
