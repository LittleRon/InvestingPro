// 历史类比：拿「现在经济在什么位置」去历史里找相似的月份，再看那些月份之后的两年，
// 上证是怎么走的。
//
// 位置用实体经济来定——PPI 同比、制造业 PMI，再加康波给的长期背景。位置是经济的，
// 看的是股市，这两件事分开是这个类比的意义：它不说「股市会怎么走」，只说
// 「经济在类似位置时，过去那些次之后股市确实走过什么」。
//
// 它是回顾性的统计，不是预测：不做外推，不给出未来的点位，也不构成投资建议。
import type { Point } from "./logic.ts";

export interface AnaloguePath {
  /** 距离那个月份过去了几个月。 */
  offset: number;
  /** 相对那个月份的涨跌幅（%）。 */
  pct: number;
}

export interface Analogue {
  at: string;
  /** 与当前位置的欧氏距离，越小越像。 */
  distance: number;
  ppi: number | null;
  pmi: number | null;
  path: AnaloguePath[];
}

export interface AnalogueResult {
  current: { at: string; ppi: number | null; pmi: number | null } | null;
  analogues: Analogue[];
  /** 这几段历史路径的逐月中位数，用来画一条「历史典型路径」。 */
  median: AnaloguePath[];
  /** 用了多少个月的历史参与比较。 */
  compared: number;
}

function zscore(values: (number | null)[]): (number | null)[] {
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const mu = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
  const variance = clean.length ? clean.reduce((a, v) => a + (v - mu) ** 2, 0) / clean.length : 0;
  const sd = Math.sqrt(variance);
  // 整段没有变化的维度记成 0（它区分不了任何月份，但也不该让整段类比失效）；真正缺的仍是 null。
  return values.map((v) => (v === null || !Number.isFinite(v) ? null : sd < 1e-9 ? 0 : (v - mu) / sd));
}

export function findAnalogues(input: {
  months: string[];
  ppi: (number | null)[];
  pmi: (number | null)[];
  kondratiev: number[];
  price: (number | null)[];
  forwardMonths?: number;
  top?: number;
}): AnalogueResult {
  const forwardMonths = input.forwardMonths ?? 24;
  const top = input.top ?? 5;
  const { months, price } = input;
  const zPpi = zscore(input.ppi);
  const zPmi = zscore(input.pmi);
  const zK = zscore(input.kondratiev.map((v) => v));

  // 只用三点都有的月份；最后 forwardMonths 个月没有完整的后续走势，不参与比较。
  const usable: number[] = [];
  for (let i = 0; i < months.length - forwardMonths; i++) {
    if (zPpi[i] === null || zPmi[i] === null || zK[i] === null || price[i] === null) continue;
    usable.push(i);
  }
  const last = months.length - 1;
  const currentVector = [zPpi[last], zPmi[last], zK[last]];
  if (currentVector.some((v) => v === null || v === undefined) || !usable.length) {
    return { current: null, analogues: [], median: [], compared: 0 };
  }
  const cv = currentVector as number[];

  const scored = usable.map((i) => {
    const d = Math.sqrt(
      (zPpi[i]! - cv[0]!) ** 2 + (zPmi[i]! - cv[1]!) ** 2 + (zK[i]! - cv[2]!) ** 2,
    );
    return { i, distance: d };
  }).sort((a, b) => a.distance - b.distance);

  const picked = scored.slice(0, top);
  const analogues: Analogue[] = [];
  for (const { i, distance } of picked) {
    const base = price[i]!;
    const path: AnaloguePath[] = [];
    for (let k = 1; k <= forwardMonths && i + k < months.length; k++) {
      const later = price[i + k]!;
      if (later === null) continue;
      path.push({ offset: k, pct: (later / base - 1) * 100 });
    }
    analogues.push({ at: months[i]!, distance, ppi: input.ppi[i]!, pmi: input.pmi[i]!, path });
  }

  // 逐月中位数：几个历史样本在每个月上的涨跌取中间那个。
  const median: AnaloguePath[] = [];
  for (let k = 1; k <= forwardMonths; k++) {
    const values = analogues.map((a) => a.path.find((p) => p.offset === k)?.pct).filter((v): v is number => v !== undefined);
    if (!values.length) continue;
    values.sort((a, b) => a - b);
    const mid = values.length % 2 ? values[(values.length - 1) / 2]! : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2;
    median.push({ offset: k, pct: mid });
  }

  return {
    current: { at: months[last]!, ppi: input.ppi[last]!, pmi: input.pmi[last]! },
    analogues,
    median,
    compared: usable.length,
  };
}

/** 月度序列：日线取每个自然月的最后一条。 */
export function toMonthly(points: Point[]): Point[] {
  const last = new Map<string, Point>();
  for (const p of points) {
    const key = p.at.slice(0, 7);
    if (!last.has(key) || p.at > last.get(key)!.at) last.set(key, p);
  }
  return [...last.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
}
