// 中国三周期曲线：拟合与滚动样本外检验。
//
// 被解释的是「未来 5 个月的股市对数收益」而不是当期收益——股市本来就应该领先实体周期
// （上一版实测是股市波峰领先合成曲线 5 个月），那个领先不是要修的偏差，而是可预测性的来源，
// 所以这里把它反过来用：拿 t 时刻能拿到的周期位置与领先指标，去预测 t 之后 5 个月的方向。
//
// 纪律（防过拟合，也是这个脚本唯一的可信来源）：
//   - 自变量一律用扩张窗口 z-score 标准化（康波是 -1~1，PPI 是 -8~13，PMI 是 45~52，
//     不标准化 OLS 系数会随量级漂移，预测幅度必然失真）；
//   - 超参数（领先期、回归系数）只在训练窗口内选，训练窗随 t 走；
//   - 宏观数据有发布滞后，t 月的 PPI/CPI 要到次月初才看得见，按可得时点对齐；
//   - 同步指标（成交额动量、换手率）不进模型；
//   - 康波长 624 个月，样本只有两百多个月，带通滤波在它上面不可行，只能用锚点，
//     所以康波一律是假设外推，报告里会标出来。
//
// 用法：node scripts/cn-cycles.ts [--out <目录>] [--horizon 5]
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchEastMoney } from "../modules/macro-dashboard/collect/eastmoney.ts";
import { fetchCsIndex } from "../modules/macro-dashboard/collect/csindex.ts";
import { cfFilter, removeLinearTrend, toLogs, type Point } from "../modules/macro-dashboard/logic.ts";

const monthKey = (at: string) => at.slice(0, 7);
const toIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

function toMonthly(points: Point[]): Point[] {
  const last = new Map<string, Point>();
  for (const p of points) if (!last.has(monthKey(p.at)) || p.at > last.get(monthKey(p.at))!.at) last.set(monthKey(p.at), p);
  return [...last.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** 缺失的月份沿用上一个月（宏观指标偶发缺月）。 */
function fillForward(keys: string[], values: Map<string, number>): (number | null)[] {
  const out: (number | null)[] = [];
  let carried: number | null = null;
  for (const k of keys) {
    const v = values.get(k) ?? null;
    if (v !== null) carried = v;
    out.push(carried);
  }
  return out;
}

function mean(xs: number[]): number {
  const clean = xs.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : NaN;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[pivot]![c]!)) pivot = r;
    [M[c], M[pivot]] = [M[pivot]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c || !M[r]![c]) continue;
      const f = M[r]![c]! / d;
      for (let col = c; col <= n; col++) M[r]![col]! -= f * M[c]![col]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

/** 岭回归。ridge 是收缩强度：自变量标准化后 0.05~0.2 都在合理范围，用来压住小样本下的系数爆炸。 */
function ridge(X: number[][], y: number[], ridge = 0.1): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      b[a]! += X[i]![a]! * y[i]!;
      for (let c = 0; c < k; c++) A[a]![c]! += X[i]![a]! * X[i]![c]!;
    }
  }
  for (let a = 1; a < k; a++) A[a]![a]! += ridge * X.length;
  return solve(A, b);
}

/** 扩张窗口 z-score：每个时点只用截至当时的数据算均值和标准差，不看未来。 */
function expandingZ(values: (number | null)[]): (number | null)[] {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const out: (number | null)[] = [];
  for (const v of values) {
    if (v !== null) { sum += v; sumSq += v * v; n++; }
    const mu = n ? sum / n : 0;
    const sd = n > 1 ? Math.sqrt(Math.max(0, sumSq / n - mu * mu)) : 0;
    out.push(v === null ? null : sd < 1e-9 ? 0 : (v - mu) / sd);
  }
  return out;
}

/**
 * 按已知的周期谷底锚定相位。相邻谷底之间的实测间隔当作这一段的长度，
 * 最后一段用前面几段的平均长度外推——外推段是假设，不是模型算出来的。
 */
function anchoredCycle(months: string[], troughs: string[], nominal: number): number[] {
  const idx = months.map(toIndex);
  const troughIdx = troughs.map(toIndex);
  const lengths: number[] = [];
  for (let i = 1; i < troughIdx.length; i++) lengths.push(troughIdx[i]! - troughIdx[i - 1]!);
  const avg = lengths.length ? mean(lengths) : nominal;
  return idx.map((t) => {
    let seg = 0;
    for (let i = 1; i < troughIdx.length; i++) if (t >= troughIdx[i]!) seg = i;
    const start = troughIdx[seg]!;
    const length = seg < troughIdx.length - 1 ? lengths[seg]! : avg;
    return -Math.cos((2 * Math.PI * (t - start)) / length);
  });
}

/**
 * 用 CF 带通滤波从数据里直接提周期分量（取对数 → 去趋势 → 带通）。
 * 只有样本够长时才成立：康波 624 个月，样本两百多个月，提不出来，所以调用方只对短、中周期用它。
 */
function filteredCycle(logValues: number[], lowMonths: number, highMonths: number): number[] {
  const detrended = removeLinearTrend(logValues);
  const { filtered } = cfFilter(detrended, lowMonths, highMonths);
  return filtered.map((v) => v * 100);
}

function hpCycle(logValues: number[], lambda = 129600): number[] {
  const n = logValues.length;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) A[i]![i]! += 1;
  for (let i = 2; i < n; i++) {
    for (const [r, c, w] of [[i, i, 1], [i, i - 1, -2], [i, i - 2, 1]] as const) {
      for (const [r2, c2, w2] of [[i, i, 1], [i, i - 1, -2], [i, i - 2, 1]] as const) {
        A[c]![c2]! += lambda * w * w2;
      }
    }
  }
  const trend = solve(A, [...logValues]);
  return logValues.map((v, i) => v - trend[i]!);
}

/** 一个标准化序列在 t 时刻相对半年前的变化（信贷脉冲式的构造）。 */
function pulse(z: (number | null)[], lag: number, t: number): number {
  const now = z[t - lag] ?? 0;
  const then = z[Math.max(0, t - lag - 6)] ?? 0;
  return now - then;
}

const KITCHIN_TROUGHS = ["2001-09", "2005-03", "2008-09", "2012-05", "2016-01", "2019-09", "2023-03"];
const JUGLAR_TROUGHS = ["2008-09", "2015-09", "2024-03"];
const KONDRATIEV_TROUGHS = ["1982-01"];
/** 宏观数据的发布滞后（月）：当月数据要过几个月才拿得到。 */
const PUBLISH_LAG = { ppi: 1, cpi: 1, pmi: 0, m0: 1 } as const;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

async function main() {
  const horizon = Number(flag("horizon", "5"));
  const outDir = flag("out", ".data/cn-cycles");
  const [ppi, cpi, pmi, m0, shanghai, bond] = await Promise.all([
    fetchEastMoney("ppi"), fetchEastMoney("cpi"), fetchEastMoney("pmi"), fetchEastMoney("m0"),
    fetchCsIndex("shanghai"), fetchCsIndex("bond"),
  ]);
  const shMonthly = toMonthly(shanghai);
  const bondMonthly = toMonthly(bond);
  const months = shMonthly.map((p) => monthKey(p.at));
  const price = new Map(shMonthly.map((p) => [monthKey(p.at), p.value]));
  const bondMap = new Map(bondMonthly.map((p) => [monthKey(p.at), p.value]));

  const series = (points: Point[]) => fillForward(months, new Map(points.map((p) => [monthKey(p.at), p.value])));
  const raw = { ppi: series(ppi), cpi: series(cpi), pmi: series(pmi), m0: series(m0) };

  const logPrice = months.map((k) => Math.log(price.get(k)!));
  // 被解释变量：未来 horizon 个月的累计对数收益（最后 horizon 个月没有实现值）。
  const forward = months.map((_, i) => (i + horizon < months.length ? logPrice[i + horizon]! - logPrice[i]! : null));
  const bond12 = months.map((k, i) => {
    const now = bondMap.get(k);
    const then = i >= 12 ? bondMap.get(months[i - 12]!) : null;
    return now && then ? (now / then - 1) * 100 : null;
  });

  // 滚动 CF：每个 t 只用截至 t 的数据提一次基钦分量。全样本双侧滤波在 t 时刻会用到 t 之后的
  // 数据，那是前视偏差——拿它去做样本外预测，等于偷看答案。所以这里逐点重算。
  // 朱格拉（96–120 个月）要 240 个月的窗口，康波要 624 个月，样本都远远不够，只能用锚点。
  const rollingKitchin: (number | null)[] = new Array(months.length).fill(null);
  for (let t = 95; t < months.length; t++) {
    const { filtered } = cfFilter(removeLinearTrend(logPrice.slice(0, t + 1)), 36, 48);
    rollingKitchin[t] = filtered[filtered.length - 1]! * 100;
  }
  // 康波只能锚点：624 个月的周期在 262 个月样本上提不出来。
  const kondratiev = anchoredCycle(months, KONDRATIEV_TROUGHS, 624);
  const kitchinAnchored = anchoredCycle(months, KITCHIN_TROUGHS, 41);
  const juglarAnchored = anchoredCycle(months, JUGLAR_TROUGHS, 108);
  // 短、中周期改用数据驱动：CF 带通（36–48 个月、96–120 个月）。
  const kitchinFiltered = filteredCycle(logPrice, 36, 48);
  const juglarFiltered = filteredCycle(logPrice, 96, 120);

  const z = (values: (number | null)[]) => expandingZ(values);
  const zkA = z(kitchinAnchored.map((v) => v));
  const zjA = z(juglarAnchored.map((v) => v));
  const zkF = z(rollingKitchin);
  const zjF = z(juglarFiltered.map((v) => v));
  const zk = z(kondratiev.map((v) => v));
  const zPpi = z(raw.ppi);
  const zCpi = z(raw.cpi);
  const zPmi = z(raw.pmi);
  const zM0 = z(raw.m0);
  const zBond = z(bond12);

  const oosStart = Math.max(months.indexOf("2019-01"), 60);
  // 基钦用滚动 CF（数据驱动），朱格拉与康波用锚点（样本不够长，提不出来）。
  // 这是在中国数据上唯一既没有前视偏差、又能落地的组合。
  const models = {
    "锚点三周期": (t: number) => [zkA[t] ?? 0, zjA[t] ?? 0, zk[t] ?? 0],
    "锚点三周期 + 领先指标": (t: number) => [
      zkA[t] ?? 0, zjA[t] ?? 0, zk[t] ?? 0,
      zPpi[t - PUBLISH_LAG.ppi] ?? 0, zCpi[t - PUBLISH_LAG.cpi] ?? 0, zPmi[t] ?? 0,
      zM0[t - PUBLISH_LAG.m0] ?? 0, zBond[t] ?? 0,
    ],
    "滚动基钦+锚点中长 + 领先": (t: number) => [
      zkF[t] ?? 0, zjA[t] ?? 0, zk[t] ?? 0,
      zPpi[t - PUBLISH_LAG.ppi] ?? 0, zCpi[t - PUBLISH_LAG.cpi] ?? 0, zPmi[t] ?? 0,
      zM0[t - PUBLISH_LAG.m0] ?? 0, zBond[t] ?? 0,
    ],
    "只领先指标": (t: number) => [
      zPpi[t - PUBLISH_LAG.ppi] ?? 0, zCpi[t - PUBLISH_LAG.cpi] ?? 0, zPmi[t] ?? 0,
      zM0[t - PUBLISH_LAG.m0] ?? 0, zBond[t] ?? 0,
    ],
    "滚动基钦+锚点中长": (t: number) => [zkF[t] ?? 0, zjA[t] ?? 0, zk[t] ?? 0],
    // 信贷脉冲式：宏观指标除了水平，再给一份「近半年增速的变化」。对资产价格有影响的往往是
    // 变化本身，不是水平——社融脉冲之所以被当成 A 股的领先信号，就是这个道理。
    "滚动基钦+锚点中长 + 领先脉冲": (t: number) => [
      zkF[t] ?? 0, zjA[t] ?? 0, zk[t] ?? 0,
      zPpi[t - PUBLISH_LAG.ppi] ?? 0, pulse(zPpi, PUBLISH_LAG.ppi, t),
      zCpi[t - PUBLISH_LAG.cpi] ?? 0, pulse(zCpi, PUBLISH_LAG.cpi, t),
      zPmi[t] ?? 0, pulse(zPmi, 0, t),
      zM0[t - PUBLISH_LAG.m0] ?? 0, pulse(zM0, PUBLISH_LAG.m0, t),
      zBond[t] ?? 0, pulse(zBond, 0, t),
    ],
  };

  const variants: { name: string; features: (t: number) => number[] }[] = [
    { name: "锚点三周期", features: models["锚点三周期"] },
    { name: "锚点三周期+领先", features: models["锚点三周期 + 领先指标"] },
    { name: "领先指标（水平）", features: models["只领先指标"] },
    { name: "滚动基钦+领先", features: models["滚动基钦+锚点中长 + 领先"] },
    { name: "滚动基钦+领先脉冲", features: models["滚动基钦+锚点中长 + 领先脉冲"] },
  ];
  const ridgeCandidates = [0.03, 0.3, 1, 3, 10];
  // 每个起点都从头滚一遍：起得早，训练窗就短，这才是真实的事前预测。
  const roll = (features: (t: number) => number[], from: number, target: (number | null)[] = forward) => {
    const pred: (number | null)[] = new Array(months.length).fill(null);
    for (let t = from; t < months.length; t++) {
      const X: number[][] = [];
      const y: number[] = [];
      for (let s = 0; s + horizon < t; s++) {
        X.push([1, ...features(s)]);
        y.push(target[s]!);
      }
      if (X.length < 36) continue;
      const strength = selectRidge(X, y, ridgeCandidates);
      const beta = ridge(X, y, strength);
      pred[t] = [1, ...features(t)].reduce((acc, v, i) => acc + v * beta[i]!, 0);
    }
    return pred;
  };

  // 方向命中的基准：未来这段时间是上涨的月份占多少。永远猜涨也能拿到这个命中率，
  // 模型的方向命中率必须跟它比才有意义。
  const realized = forward.filter((v): v is number => v !== null);
  const upShare = realized.filter((v) => v > 0).length / Math.max(1, realized.length);
  console.log(`样本内未来 ${horizon} 个月上涨的月份占 ${(upShare * 100).toFixed(0)}%：这就是「永远猜涨」的方向命中率，模型必须高过它才算有信息。\n`);

  // 另一组目标：不预测收益本身，预测股市周期分量的变化（收益噪声大，周期位置平滑些）。
  const forwardCycle = months.map((_, i) => {
    const now = rollingKitchin[i];
    const later = rollingKitchin[i + horizon];
    return now !== null && later !== null && later !== undefined ? later - now : null;
  });
  const cycleResults: Record<string, number> = {};
  for (const { name, features } of variants) {
    const pred = roll(features, oosStart, forwardCycle);
    const pairs = months.map((_, i) => [pred[i], forwardCycle[i]] as [number | null, number | null])
      .filter((p, i): p is [number, number] => p[0] !== null && p[1] !== null && i >= oosStart - horizon);
    if (pairs.length) cycleResults[name] = r2Of(pairs.map(([p]) => p), pairs.map(([, a]) => a));
  }
  const results: Record<string, Record<string, { r2: number; corr: number; rmse: number; hits: number; total: number; dir: number; dirTotal: number }>> = {};
  const predictions: Record<string, (number | null)[]> = {};
  for (const { name, features } of variants) {
    // 存进 CSV 的是最晚那个起点的预测（训练数据最多，也就是站上真正会用的那条）。
    predictions[name] = roll(features, oosStart);
    for (const start of ["2015-01", "2017-01", "2019-01", "2021-01"]) {
      const from = months.indexOf(start);
      if (from < 0) continue;
      const pred = start === "2019-01" ? predictions[name]! : roll(features, from);
      const pairs = months.map((_, i) => [pred[i], forward[i]] as [number | null, number | null])
        .filter((p, i): p is [number, number] => p[0] !== null && p[1] !== null && i >= from - horizon);
      if (!pairs.length) continue;
      const yb = mean(pairs.map(([, a]) => a));
      const ssRes = pairs.reduce((a, [p, yy]) => a + (yy - p) ** 2, 0);
      const ssTot = pairs.reduce((a, [, yy]) => a + (yy - yb) ** 2, 0);
      const turn = turningHits(forward, pred);
      const dir = directionHits(pairs.map(([p]) => p), pairs.map(([, a]) => a));
      (results[name] ??= {})[start] = {
        r2: ssTot ? 1 - ssRes / ssTot : NaN,
        corr: correlation(pairs.map(([p]) => p), pairs.map(([, a]) => a)),
        rmse: Math.sqrt(ssRes / pairs.length),
        hits: turn.hits,
        total: turn.total,
        dir: dir.hits,
        dirTotal: dir.total,
      };
    }
  }

  console.log(`样本 ${months[0]} → ${months[months.length - 1]}（${months.length} 个月）  预测未来 ${horizon} 个月收益`);
  console.log(`收缩强度在训练窗内用时间顺序交叉验证挑（不在样本外挑），常数基线 R²=0\n`);
  const starts = ["2015-01", "2017-01", "2019-01", "2021-01"];
  console.log("OOS R²（不同起点）".padEnd(24) + starts.map((s) => s.padEnd(10)).join(""));
  for (const [name, byStart] of Object.entries(results)) {
    console.log(name.padEnd(22) + starts.map((s) => (byStart[s] ? byStart[s]!.r2.toFixed(3) : "—").padEnd(10)).join(""));
  }
  console.log("\n以 2019-01 起点的完整表现：");
  console.log("模型".padEnd(24) + "R²".padEnd(9) + "corr".padEnd(9) + "方向命中".padEnd(11) + "拐点命中");
  for (const [name, byStart] of Object.entries(results)) {
    const r = byStart["2019-01"];
    if (!r) continue;
    const dir = r.dirTotal ? `${r.dir}/${r.dirTotal}（${((r.dir / r.dirTotal) * 100).toFixed(0)}%）` : "—";
    const hit = r.total ? `${r.hits}/${r.total}（${((r.hits / r.total) * 100).toFixed(0)}%）` : "—";
    console.log(name.padEnd(22) + r.r2.toFixed(3).padEnd(9) + r.corr.toFixed(3).padEnd(9) + dir.padEnd(11) + hit);
  }
  const best = Object.entries(results)
    .map(([name, byStart]) => [name, byStart["2019-01"]?.r2 ?? -Infinity] as const)
    .sort((a, b) => b[1] - a[1])[0]!;
  const hp = hpCycle(logPrice);
  // 实体经济口径：用 PPI 提的基钦去看股市周期。这才是真信号——拿股市自己的分量去比股市
  // 自己的 HP 分量是同源自证，相关再高也不算证据。
  const ppiAt = raw.ppi.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  const ppiCycle = cfFilter(removeLinearTrend(ppiAt.map((i) => raw.ppi[i]!)), 36, 48).filtered;
  const ppiFull: (number | null)[] = new Array(months.length).fill(null);
  ppiAt.forEach((mi, i) => { ppiFull[mi] = ppiCycle[i]!; });
  console.log("\n描述口径（都含滤波端点偏差，只作参照，不用于预测）：");
  console.log(`  股市序列提的基钦 vs 股市 HP 分量        ${correlation(kitchinFiltered, hp).toFixed(3)}  ← 同源，必然虚高，不作证据`);
  console.log(`  PPI 提的基钦 vs 股市 HP 分量（实体口径） ${correlation(ppiFull, hp.map((v) => v)).toFixed(3)}`);
  console.log("\n改预测「股市周期分量的变化」而不是收益本身（2019 起点）：");
  for (const [name, r2] of Object.entries(cycleResults)) console.log(`  ${name.padEnd(22)} R²=${r2.toFixed(3)}`);
  console.log(`\n2019 起点下最好的是「${best[0]}」，R²=${best[1].toFixed(3)}。`);
  console.log(`起点的不同能让 R² 在 ${minAcrossStarts(results).toFixed(3)} 到 ${maxAcrossStarts(results).toFixed(3)} 之间摆动，这样的结果不能拿去做预测。`);
  writeCsv(outDir, months, { price, forward, hp, kitchinAnchored, juglarAnchored, kondratiev, kitchinFiltered, juglarFiltered, ...raw, bond12 }, predictions);
}

function anchoredComposite(months: string[]): number[] {
  const k = anchoredCycle(months, KITCHIN_TROUGHS, 41);
  const j = anchoredCycle(months, JUGLAR_TROUGHS, 108);
  const c = anchoredCycle(months, KONDRATIEV_TROUGHS, 624);
  return k.map((v, i) => 0.45 * v + 0.35 * j[i]! + 0.2 * c[i]!);
}

function filteredComposite(months: string[], k: number[], j: number[], c: number[]): number[] {
  return k.map((v, i) => 0.45 * v + 0.35 * j[i]! + 0.2 * c[i]!);
}

/** 两条序列的相关，只在两边都有值的那些时点上算。 */
function correlation(a: (number | null)[], b: (number | null)[]): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  const n = xs.length;
  if (n < 3) return NaN;
  const ma = mean(xs);
  const mb = mean(ys);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]! - ma) * (ys[i]! - mb); da += (xs[i]! - ma) ** 2; db += (ys[i]! - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}

/** 所有模型在所有起点上的 R² 极值，用来说明结论稳不稳。 */
function minAcrossStarts(results: Record<string, Record<string, { r2: number }>>): number {
  return Math.min(...Object.values(results).flatMap((r) => Object.values(r).map((v) => v.r2)));
}

function maxAcrossStarts(results: Record<string, Record<string, { r2: number }>>): number {
  return Math.max(...Object.values(results).flatMap((r) => Object.values(r).map((v) => v.r2)));
}

/** 一组预测值对一组实现值的 R²（内部交叉验证挑超参数时用）。 */
function r2Of(preds: number[], actual: number[]): number {
  const yb = mean(actual);
  const ssRes = preds.reduce((a, p, i) => a + (actual[i]! - p) ** 2, 0);
  const ssTot = actual.reduce((a, y) => a + (y - yb) ** 2, 0);
  return ssTot ? 1 - ssRes / ssTot : -Infinity;
}

/**
 * 在训练窗内部做一次时间顺序的交叉验证，挑收缩强度。
 * 超参数不能拿样本外的表现回头选——那是拿答案改答案；只能在当时能看到的数据里选。
 */
function selectRidge(X: number[][], y: number[], candidates: number[]): number {
  const split = Math.floor(X.length * 0.7);
  if (X.length - split < 12) return candidates[Math.floor(candidates.length / 2)]!;
  const Xtr = X.slice(0, split);
  const ytr = y.slice(0, split);
  const Xva = X.slice(split);
  const yva = y.slice(split);
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const r of candidates) {
    const beta = ridge(Xtr, ytr, r);
    const score = r2Of(Xva.map((row) => row.reduce((a, v, i) => a + v * beta[i]!, 0)), yva);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/** 方向命中率：预测为正的月份里，后来真涨了的比例（只看有明确方向判断的那些）。 */
function directionHits(preds: number[], actual: number[]): { hits: number; total: number } {
  let hits = 0;
  let total = 0;
  for (let i = 0; i < preds.length; i++) {
    if (Math.abs(preds[i]!) < 1e-6) continue;
    total++;
    if (Math.sign(preds[i]!) === Math.sign(actual[i]!)) hits++;
  }
  return { hits, total };
}

/** 拐点命中：模型信号的局部极值 vs 实现序列的局部极值，容差 ±3 个月。 */
function turningHits(actual: (number | null)[], predicted: (number | null)[]): { hits: number; total: number } {
  const find = (s: (number | null)[], kind: 1 | -1) => {
    const out: number[] = [];
    for (let i = 3; i < s.length - 3; i++) {
      const v = s[i];
      if (v === null) continue;
      const around = [s[i - 3], s[i - 2], s[i - 1], s[i + 1], s[i + 2], s[i + 3]];
      if (around.some((x) => x === null)) continue;
      if (kind === 1 && around.every((x) => v! >= x!)) out.push(i);
      if (kind === -1 && around.every((x) => v! <= x!)) out.push(i);
    }
    return out;
  };
  let hits = 0;
  let total = 0;
  for (const kind of [1, -1] as const) {
    const real = find(actual, kind);
    const model = find(predicted, kind);
    for (const at of real) {
      total++;
      if (model.some((m) => Math.abs(m - at) <= 3)) hits++;
    }
  }
  return { hits, total };
}

function writeCsv(
  outDir: string,
  months: string[],
  data: Record<string, (number | null)[] | Map<string, number>>,
  predictions: Record<string, (number | null)[]>,
) {
  mkdirSync(outDir, { recursive: true });
  const cols: [string, (i: number) => number | null][] = [
    ["shanghai_close", (i) => (data.price as Map<string, number>).get(months[i]!) ?? null],
    ["hp_cycle", (i) => (data.hp as (number | null)[])[i]!],
    ["kitchin_anchored", (i) => (data.kitchinAnchored as (number | null)[])[i]!],
    ["juglar_anchored", (i) => (data.juglarAnchored as (number | null)[])[i]!],
    ["kondratiev_anchored", (i) => (data.kondratiev as (number | null)[])[i]!],
    ["kitchin_filtered", (i) => (data.kitchinFiltered as (number | null)[])[i]!],
    ["juglar_filtered", (i) => (data.juglarFiltered as (number | null)[])[i]!],
    ["ppi_yoy", (i) => (data.ppi as (number | null)[])[i]!],
    ["cpi_yoy", (i) => (data.cpi as (number | null)[])[i]!],
    ["pmi", (i) => (data.pmi as (number | null)[])[i]!],
    ["m0_yoy", (i) => (data.m0 as (number | null)[])[i]!],
    ["bond_12m_momentum", (i) => (data.bond12 as (number | null)[])[i]!],
    ["forward_return_pct", (i) => { const v = (data.forward as (number | null)[])[i]!; return v === null ? null : v * 100; }],
    ...Object.entries(predictions).map(([name, pred]) => [`pred_${name.replaceAll(" ", "_")}_pct`, (i: number) => {
      const v = pred[i];
      return v === null ? null : v * 100;
    }] as [string, (i: number) => number | null]),
  ];
  const lines = [["month", ...cols.map(([n]) => n)].join(",")];
  for (let i = 0; i < months.length; i++) {
    lines.push([months[i], ...cols.map(([, get]) => fmt(get(i)))].join(","));
  }
  writeFileSync(`${outDir}/cn-cycles.csv`, lines.join("\n"));
  console.log(`\n明细已写入 ${outDir}/cn-cycles.csv（${months.length} 行）`);
}

function fmt(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "" : String(Math.round(v * 100000) / 100000);
}

if (import.meta.main) main().catch((error) => { console.error(error); process.exit(1); });
