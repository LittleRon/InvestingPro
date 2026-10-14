// 信号置信度：把“这条消息有多可核查”拆成三个透明成分，全部由公开数据计算，不调用模型。
//   evidence    来源强度（0–50）：报道方里最高的信源分级。T1 官方一手最高，T1_5 次之，T2 媒体与个人再次；
//              只有讨论账号、没有精选报道方时给保底分。
//   cross       交叉印证（0–30）：独立报道方越多越可信，每个 6 分，6 家以上封顶。
//   discussion  讨论佐证（0–20）：参与讨论的独立账号越多越多人盯上，每个 2 分，10 个以上封顶。
// 置信度衡量的是信息的可核查程度，不是投资建议，也不预测涨跌；这一点在页面上对读者写明。

export interface SignalParticipant {
  kind: "editorial" | "signal";
  tier?: string;
}

export interface ConfidenceParts {
  evidence: number;
  cross: number;
  discussion: number;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Confidence {
  score: number;
  level: ConfidenceLevel;
  parts: ConfidenceParts;
}

/** 信源分级 → 来源强度。未列出或缺失的分级按最低档计。 */
const TIER_EVIDENCE: Record<string, number> = { T1: 50, T1_5: 38, T2: 26 };

const NO_EDITORIAL_EVIDENCE = 10;
const CROSS_PER_SOURCE = 6;
const CROSS_CAP = 30;
const DISCUSSION_PER_PARTICIPANT = 2;
const DISCUSSION_CAP = 20;

export function confidenceOf(participants: readonly SignalParticipant[]): Confidence {
  const editorial = participants.filter((p) => p.kind === "editorial");
  const evidence = editorial.reduce((best, p) => Math.max(best, TIER_EVIDENCE[p.tier ?? ""] ?? 0), 0) || NO_EDITORIAL_EVIDENCE;
  const cross = Math.min(CROSS_CAP, editorial.length * CROSS_PER_SOURCE);
  const discussion = Math.min(DISCUSSION_CAP, participants.length * DISCUSSION_PER_PARTICIPANT);
  const score = evidence + cross + discussion;
  return { score, level: confidenceLevel(score), parts: { evidence, cross, discussion } };
}

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "高置信度",
  medium: "中置信度",
  low: "待确认",
};

/** 页面“怎么算的”里的说明，和上面的规则一一对应。 */
export const CONFIDENCE_METHOD = [
  "来源强度：报道方里最高的信源分级，官方一手 50 分、官方账号与准官方 38 分、媒体与个人 26 分，没有精选报道方时保底 10 分。",
  "交叉印证：独立报道方每个 6 分，6 家以上封顶 30 分。",
  "讨论佐证：参与讨论的独立账号每个 2 分，10 个以上封顶 20 分。",
  "三项相加为 0–100 的信号置信度：75 以上为高置信度，50 以上为中置信度，其余为待确认。",
];

/** 板块趋势：当前 7 天与前 7 天的收录条数之比，说明一个板块是在升温还是降温。 */
export interface TrendCounts {
  current: number;
  prior: number;
  today: number;
}

export function trendOf(counts: TrendCounts): "up" | "down" | "flat" {
  if (counts.prior === 0) return counts.current > 0 ? "up" : "flat";
  if (counts.current === 0) return "down";
  const ratio = counts.current / counts.prior;
  if (ratio >= 1.25) return "up";
  if (ratio <= 0.8) return "down";
  return "flat";
}

/** 变化幅度：没有可比基数时返回 null，页面显示“新增”。 */
export function trendPct(counts: TrendCounts): number | null {
  if (counts.prior === 0) return null;
  return Math.round(((counts.current - counts.prior) / counts.prior) * 100);
}
