// 周期算法的测试（不需要数据库）。重点是滤波器按频带分开：通带里的周期留下，带外的压掉。
import assert from "node:assert/strict";
import { test } from "node:test";
import { cfFilter, cycleOf, downsample, overlayOf, removeLinearTrend, sliceRange, yoyOf, type Point } from "../logic.ts";

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

test("三条周期合起来的叠加态，缺一条就不合", () => {
  const shared = ["2020-12-31", "2021-12-31"];
  const make = (values: number[]) => shared.map((at, i) => ({ at, value: values[i]! }));
  const one = { cycle: "kondratiev", name: "长波", short: "长波", points: make([1, 2]), provisionalFrom: null, shortSample: false, latest: 2, phase: "rising" as const };
  const two = { ...one, cycle: "juglar", points: make([3, 4]) };
  const three = { ...one, cycle: "kitchin", points: make([5, 6]) };
  const overlay = overlayOf([one, two, three]);
  assert.deepEqual(overlay.points.map((p) => p.value), [3, 4]);

  // 第二条在第二个时点缺一条：那一点不进叠加态。
  const partial = { ...two, points: make([3, NaN]) };
  assert.deepEqual(overlayOf([one, partial, three]).points.map((p) => p.value), [3]);
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
