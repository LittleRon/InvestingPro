// 经济周期的算法：把一条序列拆出长波、中周期、短周期三个频带。
//
// 用的是 Christiano-Fitzgerald 带通滤波（Christiano & Fitzgerald, 2003）的对称全样本版本：
// 先给理想带通滤波器的权重，再把权重去均值（截断后的权重和不再是 0，不去均值会漏进常数项），
// 拿它和序列卷积。两个频率边界按数据的频率换算成期数：康德拉季耶夫长波 50–60 年，
// 朱格拉中周期 7–11 年，基钦短周期 3–5 年。
//
// 序列进来先取对数、再去掉线性趋势，之后滤波得到的数乘 100，读作「相对趋势的偏离百分之几」。
// 取对数让不同量级的序列可以互相比较，去趋势是因为权重去均值只消除常数、不消除趋势。
//
// 长波有它改不掉的限制：五十到六十年一轮，而公开的长序列本身也不过六七十年，样本两端
// 没有足够的邻点。滤波器在两端只能用得到的一半窗口，所以末端的位置是估计出来的，
// 新数据进来会被修正。这里不掩饰：末端若干点标成 provisional，页面上按虚线画并写明。
export type Frequency = "D" | "W" | "M" | "Q" | "A";

export interface Point {
  /** YYYY-MM-DD。 */
  at: string;
  value: number;
}

const PER_YEAR: Record<Frequency, number> = { D: 260, W: 52, M: 12, Q: 4, A: 1 };

/** 五十到六十年一轮、七到十一年一轮、三到五年一轮：频带按年给出，再换成期数。 */
export function bands(cycle: { lowYears: number; highYears: number }, frequency: Frequency): { low: number; high: number } {
  const per = PER_YEAR[frequency];
  return { low: Math.round(cycle.lowYears * per), high: Math.round(cycle.highYears * per) };
}

/** 一期一期地取对数，跳过 0 和负数（价格与产出都是正的，空值来自数据源本身的缺失）。 */
export function toLogs(values: number[]): number[] {
  return values.map((v) => (v > 0 ? Math.log(v) : NaN));
}

/** 最小二乘去掉线性趋势，返回去掉趋势后的残差。缺值的点不参与拟合，也不参与残差。 */
export function removeLinearTrend(values: number[]): number[] {
  const idx: number[] = [];
  const ys: number[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) { idx.push(i); ys.push(v); }
  });
  if (idx.length < 2) return values.map(() => NaN);
  const n = idx.length;
  const meanX = idx.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (idx[k]! - meanX) * (ys[k]! - meanY); sxx += (idx[k]! - meanX) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return values.map((v, i) => (Number.isFinite(v) ? v - (meanY + slope * (i - meanX)) : NaN));
}

/**
 * 带通滤波。`low`/`high` 是保留的周期区间（期数），比如年度序列的康波是 50 到 60。
 * 返回与输入等长的数组；两端窗口不够的点仍然算，但会被 `provisionalCount` 标出来。
 */
export function cfFilter(
  values: number[],
  low: number,
  high: number,
): { filtered: number[]; provisionalCount: number; shortSample: boolean } {
  const n = values.length;
  // 理想带通的权重。w = 2π / 周期：周期越长频率越低，所以高频端对应短周期。
  const wHigh = (2 * Math.PI) / low;
  const wLow = (2 * Math.PI) / high;
  // 窗口取到两个最长周期那么宽：窄频带（比如 50–60 年这一带）的权重在时域上衰减得慢，
  // 截得太短会把幅度削掉一半。窗口越宽，末端估计的部分也越长——这两件事是一回事。
  const K = Math.min(2 * high, Math.max(1, Math.floor((n - 1) / 2)));
  const b: number[] = [];
  for (let j = 0; j <= K; j++) {
    b[j] = j === 0 ? (wHigh - wLow) / Math.PI : (Math.sin(j * wHigh) - Math.sin(j * wLow)) / (Math.PI * j);
  }
  // 权重去均值：无限长的权重和为 0（理想带通在零频的增益是 0），截断以后不再是。
  let sum = b[0]!;
  for (let j = 1; j <= K; j++) sum += 2 * b[j]!;
  const mean = sum / (2 * K + 1);
  const weight = (j: number) => b[Math.abs(j)]! - mean;
  const filtered: number[] = [];
  for (let t = 0; t < n; t++) {
    let acc = 0;
    for (let j = -K; j <= K; j++) {
      const i = t - j;
      if (i < 0 || i >= n) continue;
      const v = values[i]!;
      if (!Number.isFinite(v)) continue;
      acc += weight(j) * v;
    }
    filtered.push(acc);
  }
  // 序列比一个完整长波还短时，滤波器拿不到足够的邻点，分离出来的长波不可靠。
  const shortSample = n < 2 * high + 1;
  return { filtered, provisionalCount: Math.min(K, n), shortSample };
}

export interface CycleSeries {
  cycle: string;
  name: string;
  short: string;
  points: Point[];
  /** 末端这些点是估计值（滤波窗口只有一半），会随新数据修正。 */
  provisionalFrom: string | null;
  /** 序列长度不足以完整分离这个频带。 */
  shortSample: boolean;
  latest: number | null;
  /** 末端所处的相位：在上升段还是下降段，以及离最近一次拐点多久。 */
  phase: "rising" | "falling" | null;
}

/**
 * 一条原始序列的周期成分。取对数、去趋势、带通滤波、乘 100 变成「偏离百分之几」。
 * 末端 K 个点标 provisional；全序列过短时 shortSample 为真。
 */
export function cycleOf(
  raw: Point[],
  frequency: Frequency,
  cycle: { key: string; name: string; short: string; lowYears: number; highYears: number },
): CycleSeries {
  const values = raw.map((p) => p.value);
  const { low, high } = bands(cycle, frequency);
  const logs = toLogs(values);
  const detrended = removeLinearTrend(logs);
  const { filtered, provisionalCount, shortSample } = cfFilter(detrended, low, high);
  const points: Point[] = filtered.map((v, i) => ({ at: raw[i]!.at, value: v * 100 }));
  const provisionalFrom = provisionalCount > 0 && provisionalCount < points.length ? points[points.length - provisionalCount]!.at : null;
  return {
    cycle: cycle.key,
    name: cycle.name,
    short: cycle.short,
    points,
    provisionalFrom,
    shortSample,
    latest: points.length ? points[points.length - 1]!.value : null,
    phase: phaseOf(points),
  };
}

/** 末端在上升还是下降：拿末端一年的点和它之前的点比，差太小就当作说不准。 */
function phaseOf(points: Point[]): "rising" | "falling" | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const diff = last.value - prev.value;
  if (Math.abs(diff) < 0.05) return null;
  return diff > 0 ? "rising" : "falling";
}

/** 同比：和（每期数）期之前比，返回百分数。期数不够或基期为 0 或缺失时该点为空。 */
export function yoyOf(points: Point[], frequency: Frequency): Point[] {
  const step = { D: 260, W: 52, M: 12, Q: 4, A: 1 }[frequency];
  return points.map((p, i) => {
    const base = points[i - step];
    if (!base || !base.value || !Number.isFinite(base.value)) return { at: p.at, value: NaN };
    return { at: p.at, value: ((p.value - base.value) / base.value) * 100 };
  }).filter((p) => Number.isFinite(p.value));
}

/**
 * 两条序列逐月相减：派生剪刀差（M1−M2、PPI−CPI）用的就是这个。两条的口径必须一致
 * （都是同比百分数），差值的单位是百分点。
 * 只出两侧都有的月份——缺一侧就不出点，宁可少一个点也不拿 0 顶上。按 YYYY-MM 对齐，
 * 输出的日期统一写成当月第一天，这样两侧日期写法不一致也不会整段错位。
 */
export function diffOf(left: Point[], right: Point[]): Point[] {
  const other = new Map(right.map((p) => [p.at.slice(0, 7), p.value]));
  const out: Point[] = [];
  for (const p of left) {
    const month = p.at.slice(0, 7);
    const value = other.get(month);
    if (value === undefined || !Number.isFinite(p.value) || !Number.isFinite(value)) continue;
    out.push({ at: `${month}-01`, value: p.value - value });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** 按时间范围裁剪。from、to 是 YYYY-MM-DD，闭区间。 */
export function sliceRange(points: Point[], from?: string | null, to?: string | null): Point[] {
  return points.filter((p) => (!from || p.at >= from) && (!to || p.at <= to));
}

/**
 * 降到最多 maxPoints 个点，等距取，首尾一定保留。日频序列几十年会有上万点，
 * 画到屏幕上既没必要也传不动。
 */
export function downsample(points: Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const out: Point[] = [points[0]!];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) out.push(points[Math.round(i * step)]!);
  out.push(points[points.length - 1]!);
  return out;
}

/** 序列最后一个值，以及它对应的日期（页面用它写「截至」）。 */
export function latestOf(points: Point[]): { value: number; at: string } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (Number.isFinite(p.value)) return { value: p.value, at: p.at };
  }
  return null;
}

/** 一个图块里几条序列共用纵轴时的范围，上下留一点余量。 */
export function extentOf(series: Point[][]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const points of series) {
    for (const p of points) {
      if (!Number.isFinite(p.value)) continue;
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.08 || 1;
  return { min: min - pad, max: max + pad };
}

/**
 * 按已知的周期谷底锚定相位：相邻谷底之间的实测间隔当作这一段的长度，最后一段用前面几段的
 * 平均长度外推。数据不够长时（康波要六百多个月，而公开序列只有两百来个月）带通滤波提不出来，
 * 只能用这种办法——代价是最后那段是假设外推，不是算出来的。
 */
export function anchoredCycle(at: string[], troughs: string[], nominalMonths: number): number[] {
  const index = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const idx = at.map(index);
  const troughIdx = troughs.map(index);
  const lengths: number[] = [];
  for (let i = 1; i < troughIdx.length; i++) lengths.push(troughIdx[i]! - troughIdx[i - 1]!);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : nominalMonths;
  return idx.map((t) => {
    let seg = 0;
    for (let i = 1; i < troughIdx.length; i++) if (t >= troughIdx[i]!) seg = i;
    const start = troughIdx[seg]!;
    const length = seg < troughIdx.length - 1 ? lengths[seg]! : avg;
    // 谷底取 -1：相位从谷底起算半个周期。
    return -Math.cos((2 * Math.PI * (t - start)) / length);
  });
}

const monthIndex = (at: string) => Number(at.slice(0, 4)) * 12 + Number(at.slice(5, 7)) - 1;
const monthName = (m: number) => `${String(Math.floor(m / 12)).padStart(4, "0")}-${String((m % 12) + 1).padStart(2, "0")}-01`;

/**
 * 重采样到月度网格：年度、季度的点之间按线性插值补出中间的月份。
 * 三条频率不同的序列要相加，必须落在同一张网格上。不这么做，相加就只能取日期的交集——
 * 一条月度序列会被两条季度的拖成只剩季初那四个点，等于白扔掉四分之三的观测。
 * 已经是月度的序列原样返回。
 */
export function resampleMonthly(points: Point[]): Point[] {
  const clean = points.filter((p) => Number.isFinite(p.value) && /^\d{4}-\d{2}-\d{2}$/.test(p.at)).sort((a, b) => (a.at < b.at ? -1 : 1));
  if (clean.length < 2) return clean;
  const from = monthIndex(clean[0]!.at);
  const to = monthIndex(clean[clean.length - 1]!.at);
  const out: Point[] = [];
  let i = 0;
  for (let m = from; m <= to; m++) {
    // 走到最后一个起点不晚于本月的已知点，本月的插值就在它和下一个之间。
    while (i + 1 < clean.length && monthIndex(clean[i + 1]!.at) <= m) i++;
    const a = clean[i]!;
    const b = clean[i + 1];
    const ma = monthIndex(a.at);
    if (!b || monthIndex(b.at) === ma) { out.push({ at: monthName(m), value: a.value }); continue; }
    const f = (m - ma) / (monthIndex(b.at) - ma);
    out.push({ at: monthName(m), value: a.value + (b.value - a.value) * f });
  }
  return out;
}

/**
 * 标准化：减均值除标准差。三条周期曲线的幅度天生差得远（实际 GDP 的起伏小、工业产出大），
 * 直接相加的话幅度最大的那条会把其余两条盖掉，叠加看起来就像它单独在动。
 */
export function zscoreOf(points: Point[]): Point[] {
  const clean = points.filter((p) => Number.isFinite(p.value)).map((p) => p.value);
  if (clean.length === 0) return points.map((p) => ({ at: p.at, value: NaN }));
  const mu = clean.reduce((a, v) => a + v, 0) / clean.length;
  const variance = clean.reduce((a, v) => a + (v - mu) ** 2, 0) / clean.length;
  const sd = Math.sqrt(variance);
  // 整段没有变化的序列区分不了任何时点，一律记 0，也不该让整条叠加失效。
  if (sd < 1e-9) return points.map((p) => ({ at: p.at, value: Number.isFinite(p.value) ? 0 : NaN }));
  return points.map((p) => ({ at: p.at, value: Number.isFinite(p.value) ? (p.value - mu) / sd : NaN }));
}

/**
 * 合成指数：几条量纲不同的序列各自标准化后加权平均，合成一条可比的时间序列。
 * 用来把「制造业 PMI（水平值）、PPI 同比（百分数）、M1 同比（百分数）」这类
 * 不能直接相加的指标合成一条月度景气曲线。
 * 只在所有成分都有的月份出点；某成分整段没有变化时记 0，区分不了时点但也不该让合成失效。
 */
export function blendOf(inputs: { points: Point[]; weight: number }[]): Point[] {
  const byMonth = inputs.map(({ points }) => {
    const map = new Map<string, number>();
    for (const p of points) if (Number.isFinite(p.value)) map.set(p.at.slice(0, 7), p.value);
    return map;
  });
  if (!byMonth.length) return [];
  let months = [...byMonth[0]!.keys()].sort();
  for (const m of byMonth.slice(1)) months = months.filter((k) => m.has(k));
  if (!months.length) return [];
  // 每个成分的均值与标准差只在共同月份上算：这样合成不受各条长度不一的影响。
  const stats = byMonth.map((map) => {
    const values = months.map((k) => map.get(k)!);
    const mu = values.reduce((a, v) => a + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mu) ** 2, 0) / values.length);
    return { mu, sd };
  });
  const total = inputs.reduce((a, i) => a + i.weight, 0) || 1;
  return months.map((k) => {
    let sum = 0;
    for (let i = 0; i < inputs.length; i++) {
      const { mu, sd } = stats[i]!;
      const z = sd < 1e-9 ? 0 : (byMonth[i]!.get(k)! - mu) / sd;
      sum += z * inputs[i]!.weight;
    }
    return { at: `${k}-01`, value: sum / total };
  });
}

/** 三条周期曲线按时间对齐后相加，就是叠加态：三条各自站什么位置，合起来又是什么位置。 */
export function overlayOf(
  cycles: CycleSeries[],
  /** 与 cycles 一一对应的权重，默认等权。短周期贴近当下，通常给得比长波重。 */
  weights?: number[],
): { points: Point[]; provisionalFrom: string | null; shortSample: boolean } {
  // 每条先落到月度网格，再各自标准化：不同频率的三条这才可比、可加。
  const byMonth = cycles.map((c) => {
    const map = new Map<string, number>();
    for (const p of zscoreOf(resampleMonthly(c.points))) if (Number.isFinite(p.value)) map.set(p.at.slice(0, 7), p.value);
    return map;
  });
  const w = cycles.map((_, i) => weights?.[i] ?? 1);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  // 只在三条都到齐的月份上合成，缺一条就不合，免得叠加态看起来像某一条单独在动。
  let months = byMonth.length ? [...byMonth[0]!.keys()].sort() : [];
  for (const m of byMonth.slice(1)) months = months.filter((k) => m.has(k));
  const points: Point[] = months.map((k) => ({
    at: `${k}-01`,
    value: byMonth.reduce((sum, m, i) => sum + (m.get(k) ?? 0) * w[i]!, 0) / total,
  }));
  let provisionalFrom: string | null = null;
  for (const c of cycles) if (c.provisionalFrom && (!provisionalFrom || c.provisionalFrom < provisionalFrom)) provisionalFrom = c.provisionalFrom;
  return { points, provisionalFrom, shortSample: cycles.some((c) => c.shortSample) };
}
