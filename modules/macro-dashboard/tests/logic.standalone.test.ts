// 周期算法的测试（不需要数据库）。重点是滤波器按频带分开：通带里的周期留下，带外的压掉。
import assert from "node:assert/strict";
import { test } from "node:test";
import { blendOf, cfFilter, cycleOf, diffOf, downsample, overlayOf, removeLinearTrend, sliceRange, yoyOf, type Point } from "../logic.ts";

const CYCLES = {
  kondratiev: { key: "kondratiev", name: "康德拉季耶夫长波", short: "长波", lowYears: 50, highYears: 60 },
  juglar: { key: "juglar", name: "朱格拉中周期", short: "中周期", lowYears: 7, highYears: 11 },
  kitchin: { key: "kitchin", name: "基钦短周期", short: "短周期", lowYears: 3, highYears: 5 },
};

/** 一段以 period 期为周期的正弦，幅度 1。 */
function sine(n: number, period: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / period));
}

/** 输出的最高峰值与输入幅度的比：滤波器在这个频率上的增益。 */
function gain(values: number[], low: number, high: number): number {
  const { filtered } = cfFilter(values, low, high);
  // 两端没有完整窗口，只看中间那段。
  const cut = Math.floor(values.length / 4);
  let peak = 0;
  for (let i = cut; i < values.length - cut; i++) peak = Math.max(peak, Math.abs(filtered[i]!));
  return peak;
}

test("通带里的周期留下，带外的压下去", () => {
  const long = sine(200, 55);
  // 55 年落在康波 50–60 的带里；短周期的带应该把它压到很低。
  const kept = gain(long, 50, 60);
  const dropped = gain(long, 3, 5);
  assert.ok(kept > dropped * 4, `长波留下 ${kept}，短波带外只剩 ${dropped}`);

  const short = sine(200, 4);
  assert.ok(gain(short, 3, 5) > 0.8, `短波增益 ${gain(short, 3, 5)}`);
  assert.ok(gain(short, 50, 60) < 0.2, `长波对 4 年序列的增益 ${gain(short, 50, 60)}`);
});

test("对称滤波不改相位：波峰还在原来那个位置", () => {
  // 长波图看的是位置（现在在长波的哪一段），所以相位比幅度更要紧。
  const raw = sine(200, 55);
  const { filtered } = cfFilter(raw, 50, 60);
  // 只在一个波峰的邻域里找，区间里放两个峰的话比的是谁更高，不是位置。
  const peak = (values: number[]) => {
    let best = 60;
    for (let i = 60; i < 95; i++) if (values[i]! > values[best]!) best = i;
    return best;
  };
  const shift = Math.abs(peak(raw) - peak(filtered));
  assert.ok(shift <= 2, `波峰位置差了 ${shift} 期`);
});

test("常数序列滤完是 0：权重去均值，常数项不会漏进来", () => {
  // 只看窗口完整的那一段：两端的窗口被截断，权重和不再是 0，本来就会有残留。
  const { filtered } = cfFilter(Array.from({ length: 120 }, () => 3), 7, 11);
  for (const v of filtered.slice(30, -30)) assert.ok(Math.abs(v) < 1e-9, `常数残留 ${v}`);
});

test("线性趋势去掉以后是常数，滤波不再被趋势带偏", () => {
  const trend = Array.from({ length: 100 }, (_, i) => 100 + i * 2);
  const detrended = removeLinearTrend(trend);
  const spread = Math.max(...detrended) - Math.min(...detrended);
  assert.ok(spread < 1e-8, `去趋势后还有 ${spread} 的起伏`);
});

test("缺值不参与拟合，也不参与残差", () => {
  const values = Array.from({ length: 10 }, (_, i) => 5 + i);
  values[3] = NaN;
  const detrended = removeLinearTrend(values);
  assert.ok(Number.isNaN(detrended[3]!), "缺的那点还是缺的");
  assert.ok(Math.abs(detrended[0]! + detrended[9]!) < 1e-8, "两端对称抵消");
});

test("序列比一个完整周期还短时，位置不可靠要标出来", () => {
  const { shortSample } = cfFilter(sine(60, 20), 50, 60);
  assert.equal(shortSample, true);
  const { shortSample: long } = cfFilter(sine(200, 20), 7, 11);
  assert.equal(long, false);
});

test("同比按月、按季、按年各跳过对应的期数", () => {
  const points: Point[] = Array.from({ length: 30 }, (_, i) => ({ at: `2020-01-${String(i + 1).padStart(2, "0")}`, value: 100 + i }));
  const yearly = yoyOf(points, "A");
  // 一年一期：第一个点没有前一年的值，被丢掉；新的第一个点是 101 比 100，涨 1%。
  assert.equal(yearly.length, 29);
  assert.ok(Math.abs(yearly[0]!.value - 1) < 1e-9);
  const monthly = yoyOf(points, "M");
  assert.equal(monthly.length, 30 - 12);
  assert.ok(Math.abs(monthly[0]!.value - ((112 - 100) / 100) * 100) < 1e-9);
});

test("时间范围按闭区间裁剪", () => {
  const points: Point[] = [
    { at: "2020-01-01", value: 1 },
    { at: "2021-01-01", value: 2 },
    { at: "2022-01-01", value: 3 },
  ];
  assert.deepEqual(sliceRange(points, "2021-01-01", "2021-12-31").map((p) => p.value), [2]);
  assert.equal(sliceRange(points, null, null).length, 3);
});

test("降采样保住首尾，且不超过上限", () => {
  const points: Point[] = Array.from({ length: 1000 }, (_, i) => ({ at: `2020-01-01`, value: i }));
  const out = downsample(points, 50);
  assert.equal(out.length, 50);
  assert.equal(out[0], points[0]);
  assert.equal(out[49], points[999]);
  assert.equal(downsample(points.slice(0, 10), 50).length, 10);
});

// ===== 叠加态 =====

const atMonth = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
const BASE = 2020 * 12 + 11; // 2020-12
const asCycle = (points: Point[], key: string) =>
  ({ cycle: key, name: key, short: key, points, provisionalFrom: null, shortSample: false, latest: null, phase: null });

test("年度与季度先补成月度，叠加才不会被低频的那条拖稀", () => {
  // 老做法只在三条日期相交的点上相加：年度两条 + 月度一条，只剩 2 个年度点。
  const yearly = [0, 12].map((k) => ({ at: atMonth(BASE + k), value: 1 + k / 12 }));
  const monthly = Array.from({ length: 13 }, (_, k) => ({ at: atMonth(BASE + k), value: 3 + k / 6 }));
  const third = Array.from({ length: 13 }, (_, k) => ({ at: atMonth(BASE + k), value: -1 + k / 6 }));
  const overlay = overlayOf([asCycle(yearly, "kondratiev"), asCycle(monthly, "juglar"), asCycle(third, "kitchin")]);
  assert.equal(overlay.points.length, 13, "叠加落在月度网格上，不是只剩两个年度交点");
  const values = overlay.points.map((p) => p.value);
  for (let i = 1; i < values.length; i++) assert.ok(values[i]! > values[i - 1]!, "三条同向时叠加也同向");
  // 三条形状一致，标准化后叠加首尾对称。
  assert.ok(Math.abs(values[0]! + values[values.length - 1]!) < 1e-9);
});

test("叠加前先标准化，幅度大的那条不再盖住其余两条", () => {
  const small = Array.from({ length: 13 }, (_, k) => ({ at: atMonth(BASE + k), value: k / 12 - 0.5 }));
  // 同一条形状，幅度放大一万倍。
  const big = small.map((p) => ({ at: p.at, value: p.value * 10000 }));
  const merged = overlayOf([asCycle(small, "a"), asCycle(big, "b")]).points.map((p) => p.value);
  // 同形状的两条叠加后仍应是这个形状：首尾对称、单调上升。
  assert.ok(Math.abs(merged[0]! + merged[merged.length - 1]!) < 1e-9);
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i]! > merged[i - 1]!);
  // 关键：量级仍是标准化后的个位数。直接相加会被大那条主导，差一万倍。
  assert.ok(Math.abs(merged[merged.length - 1]!) < 2, "标准化之后幅度不再主导");
  const direct = small.map((p, i) => (p.value + big[i]!.value) / 2);
  assert.ok(Math.abs(direct[direct.length - 1]!) > 1000, "（对照）直接相加会被放大那条吃掉");
});

test("权重决定谁说了算：反过来给权重，叠加就跟着反过来", () => {
  const up = Array.from({ length: 13 }, (_, k) => ({ at: atMonth(BASE + k), value: k / 12 }));
  const down = up.map((p) => ({ at: p.at, value: 1 - p.value }));
  const balanced = overlayOf([asCycle(up, "up"), asCycle(down, "down")]);
  // 等权时两条正好抵消。
  for (const p of balanced.points) assert.ok(Math.abs(p.value) < 1e-9, "等权时两条抵消");
  const tilted = overlayOf([asCycle(up, "up"), asCycle(down, "down")], [3, 1]).points.map((p) => p.value);
  assert.ok(tilted[0]! < 0 && tilted[tilted.length - 1]! > 0, "偏向上升那条时，叠加跟着上升");
});

test("缺一条的那些月份不进叠加态", () => {
  const full = Array.from({ length: 13 }, (_, k) => ({ at: atMonth(BASE + k), value: k / 12 }));
  // 第二条只有前半年。
  const partial = full.slice(0, 6);
  const overlay = overlayOf([asCycle(full, "a"), asCycle(partial, "b")]);
  assert.equal(overlay.points.length, 6, "只在两条都有的月份上合成");
  assert.equal(overlay.points[0]!.at, atMonth(BASE));
});

test("一条完整序列能算出三个频带，末端标成估计", () => {
  const raw: Point[] = Array.from({ length: 80 }, (_, i) => ({
    at: `${1946 + i}-12-31`,
    // 50 年长波 + 8 年中周期 + 4 年短周期 + 一点噪声，压在一条指数增长的序列上。
    value: Math.exp(0.02 * i + 0.3 * Math.sin((2 * Math.PI * i) / 50) + 0.2 * Math.sin((2 * Math.PI * i) / 8) + 0.1 * Math.sin((2 * Math.PI * i) / 4)),
  }));
  const long = cycleOf(raw, "A", CYCLES.kondratiev);
  const mid = cycleOf(raw, "A", CYCLES.juglar);
  const short = cycleOf(raw, "A", CYCLES.kitchin);
  for (const c of [long, mid, short]) {
    assert.equal(c.points.length, raw.length);
    assert.ok(c.latest !== null);
    assert.ok(c.provisionalFrom !== null, "样本末端必然是估计出来的");
  }
  // 三个频带分开算，结果不该一样。
  assert.notDeepEqual(long.points.map((p) => p.value.toFixed(4)), mid.points.map((p) => p.value.toFixed(4)));
  assert.notDeepEqual(mid.points.map((p) => p.value.toFixed(4)), short.points.map((p) => p.value.toFixed(4)));
});

// ===== 派生剪刀差 =====

test("剪刀差逐月相减，缺一侧的月份不出点", () => {
  const left: Point[] = [
    { at: "2026-01-01", value: 3.2 },
    { at: "2026-02-01", value: 4.0 },
    { at: "2026-03-01", value: 4.5 },
  ];
  const right: Point[] = [
    { at: "2026-01-01", value: 7.2 },
    // 二月缺
    { at: "2026-03-01", value: 7.5 },
  ];
  assert.deepEqual(diffOf(left, right), [
    { at: "2026-01-01", value: 3.2 - 7.2 },
    { at: "2026-03-01", value: 4.5 - 7.5 },
  ]);
});

test("剪刀差按月份对齐，两侧日期写法不同也不错位", () => {
  const left = [{ at: "2026-05-01", value: 5.0 }, { at: "2026-01-01", value: 1.0 }];
  // 右侧写在当月 3 号，仍是同一个月。
  const right = [{ at: "2026-01-03", value: 2.0 }, { at: "2026-05-03", value: 3.0 }];
  assert.deepEqual(diffOf(left, right), [
    { at: "2026-01-01", value: -1.0 },
    { at: "2026-05-01", value: 2.0 },
  ]);
});

test("一侧为空就没有点，不拿 0 顶上", () => {
  const left = [{ at: "2026-01-01", value: 1.0 }];
  assert.deepEqual(diffOf(left, []), []);
  assert.deepEqual(diffOf([], left), []);
});

// ===== 合成指数 =====

test("合成指数把量纲不同的几条拼成一条，只在共同月份出点", () => {
  // PMI 是 50 上下的水平值，PPI、M1 是个位数的同比：直接相加没有意义。
  const pmi = Array.from({ length: 6 }, (_, k) => ({ at: atMonth(BASE + k), value: 49 + k * 0.2 }));
  const ppi = Array.from({ length: 6 }, (_, k) => ({ at: atMonth(BASE + k), value: -1 + k * 0.5 }));
  const m1 = ppi.slice(0, 4); // 少两个月
  const out = blendOf([{ points: pmi, weight: 1 }, { points: ppi, weight: 1 }, { points: m1, weight: 1 }]);
  assert.equal(out.length, 4, "只出三条都有的月份");
  assert.equal(out[0]!.at, atMonth(BASE));
  // 三条都单调上升，合成也该单调上升。
  for (let i = 1; i < out.length; i++) assert.ok(out[i]!.value > out[i - 1]!.value);
});

test("合成时每条先标准化，量纲差一万倍也不互相盖掉", () => {
  const shape = Array.from({ length: 6 }, (_, k) => ({ at: atMonth(BASE + k), value: k / 5 - 0.5 }));
  const big = shape.map((p) => ({ at: p.at, value: p.value * 10000 }));
  const out = blendOf([{ points: shape, weight: 1 }, { points: big, weight: 1 }]);
  // 两条形状相同，合成后仍应是这个形状，且量级保持标准化后的个位数。
  for (let i = 1; i < out.length; i++) assert.ok(out[i]!.value > out[i - 1]!.value);
  assert.ok(Math.abs(out[out.length - 1]!.value) < 2, "没有被放大那条主导");
});

test("权重决定谁在合成里说了算", () => {
  const up = Array.from({ length: 6 }, (_, k) => ({ at: atMonth(BASE + k), value: k / 5 }));
  const down = up.map((p) => ({ at: p.at, value: 1 - p.value }));
  const equal = blendOf([{ points: up, weight: 1 }, { points: down, weight: 1 }]);
  for (const p of equal) assert.ok(Math.abs(p.value) < 1e-9, "等权时两条抵消");
  const tilted = blendOf([{ points: up, weight: 3 }, { points: down, weight: 1 }]);
  assert.ok(tilted[0]!.value < 0 && tilted[tilted.length - 1]!.value > 0, "偏向上升那条时跟着上升");
});
