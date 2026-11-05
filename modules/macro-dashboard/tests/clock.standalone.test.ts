// 美林时钟（中国版）的测试（不需要数据库）。重点是：四个象限的资产偏好对得上直觉、
// 重心插值在边界上平滑不跳跃、各子函数（增长趋势、通胀轴、货币政策）的口径正确、
// 空数据不报错而是中性处理。
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeClock, growthTrend, inflationAxis, monetaryStance, PPI_WEIGHT, CPI_WEIGHT } from "../clock.ts";
import type { Point } from "../logic.ts";

/** 造一条月度序列：从某月开始，每月一期，值取给定数组。 */
function series(values: number[], from = "2024-01-01"): Point[] {
  return values.map((v, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { at: d.toISOString().slice(0, 10), value: v };
  });
}

/** 六个点的 PMI：给定末端趋势。前几个点不重要，趋势看近 6 个月均值。 */
function pmiOf(tail: number[]): Point[] {
  // 前面补几个中性点，让序列长度够 6。
  const base = [50, 50, 50];
  return series([...base, ...tail]);
}

test("复苏象限：PMI 高于荣枯、PPI/CPI 低 → 股票分最高", () => {
  // PMI 近 6 个月均值 52（高于荣枯 2 点），PPI 同比 -1、CPI 同比 0.5（低通胀）。
  const res = computeClock({
    pmi: pmiOf([51, 52, 53, 52, 51, 52]),
    ppi: series([-1.2, -1.0]),
    cpi: series([0.3, 0.5]),
    m0: series([12]),
  });
  assert.equal(res.quadrant, "recovery");
  const top = [...res.assetScores].sort((a, b) => b.score - a.score)[0]!;
  assert.equal(top.key, "stocks", `股票应是最适配的，实际 ${top.name} ${top.score}`);
  assert.ok(top.score > 65, `股票分应明显偏高，实际 ${top.score}`);
});

test("过热象限：PMI 高、PPI/CPI 高 → 大宗商品分最高", () => {
  // PMI 均值 52，PPI 同比 4、CPI 同比 2（高通胀）。
  const res = computeClock({
    pmi: pmiOf([51, 52, 53, 52, 51, 52]),
    ppi: series([3.5, 4.0]),
    cpi: series([1.8, 2.0]),
    m0: series([12]),
  });
  assert.equal(res.quadrant, "overheat");
  const top = [...res.assetScores].sort((a, b) => b.score - a.score)[0]!;
  assert.equal(top.key, "commodities", `大宗商品应是最适配的，实际 ${top.name} ${top.score}`);
});

test("滞胀象限：PMI 低于荣枯、PPI/CPI 高 → 黄金/现金分最高", () => {
  // PMI 均值 48（低于荣枯），PPI 同比 4、CPI 同比 2。
  const res = computeClock({
    pmi: pmiOf([47, 48, 49, 48, 47, 48]),
    ppi: series([3.5, 4.0]),
    cpi: series([1.8, 2.0]),
    m0: series([12]),
  });
  assert.equal(res.quadrant, "stagflation");
  const top = [...res.assetScores].sort((a, b) => b.score - a.score)[0]!;
  assert.equal(top.key, "gold", `黄金应是最适配的，实际 ${top.name} ${top.score}`);
});

test("衰退象限：PMI 低于荣枯、PPI/CPI 低 → 债券分最高", () => {
  // PMI 均值 48，PPI 同比 -2、CPI 同比 0。
  const res = computeClock({
    pmi: pmiOf([47, 48, 49, 48, 47, 48]),
    ppi: series([-2.5, -2.0]),
    cpi: series([-0.2, 0.0]),
    m0: series([12]),
  });
  assert.equal(res.quadrant, "recession");
  const top = [...res.assetScores].sort((a, b) => b.score - a.score)[0]!;
  assert.equal(top.key, "bonds", `债券应是最适配的，实际 ${top.name} ${top.score}`);
});

test("重心插值在边界上平滑：相邻象限的资产分不跳跃", () => {
  // 复苏与过热的边界：通胀轴在中间值（加权通胀约 1.0），PMI 高。
  // 复苏侧（PPI/CPI 低）和过热侧（PPI/CPI 高）的大宗商品分应平滑过渡，不突变。
  const low = computeClock({ pmi: pmiOf([51, 52, 53, 52, 51, 52]), ppi: series([0.5, 0.8]), cpi: series([0.8, 1.0]), m0: series([12]) });
  const high = computeClock({ pmi: pmiOf([51, 52, 53, 52, 51, 52]), ppi: series([3.0, 3.5]), cpi: series([1.5, 1.8]), m0: series([12]) });
  const lowCommod = low.assetScores.find((a) => a.key === "commodities")!.score;
  const highCommod = high.assetScores.find((a) => a.key === "commodities")!.score;
  // 大宗商品分应随通胀升高而升高，且变化是连续量级（不是从 45 跳到 80）。
  assert.ok(highCommod > lowCommod, `通胀升高，大宗商品分应升高：${lowCommod} → ${highCommod}`);
  assert.ok(Math.abs(highCommod - lowCommod) < 40, `变化应平滑，差 ${highCommod - lowCommod}`);
});

test("增长趋势：近 6 个月 PMI 均值减荣枯线 50", () => {
  const p = pmiOf([50, 51, 52, 53, 54, 55]);
  const trend = growthTrend(p);
  assert.ok(Math.abs(trend - ((50 + 51 + 52 + 53 + 54 + 55) / 6 - 50)) < 1e-9, `趋势 ${trend}`);
  // 均值 52.5 → 趋势 +2.5。
  assert.ok(Math.abs(trend - 2.5) < 1e-9);
});

test("增长趋势：序列不足 6 个月时用全部", () => {
  const trend = growthTrend(series([48, 49, 50]));
  assert.ok(Math.abs(trend - ((48 + 49 + 50) / 3 - 50)) < 1e-9);
});

test("增长趋势：空序列返回 NaN（页面据此显示数据不足）", () => {
  assert.ok(Number.isNaN(growthTrend([])));
});

test("通胀轴：PPI×0.6 + CPI×0.4", () => {
  assert.ok(Math.abs(inflationAxis(4, 2) - (4 * PPI_WEIGHT + 2 * CPI_WEIGHT)) < 1e-9);
  assert.ok(Math.abs(inflationAxis(4, 2) - (4 * 0.6 + 2 * 0.4)) < 1e-9);
});

test("通胀轴：缺项按 0 计（不伪造）", () => {
  // 只有 PPI：CPI 缺失按 0，结果 = PPI×0.6。
  assert.ok(Math.abs(inflationAxis(4, null) - 4 * 0.6) < 1e-9);
  // 只有 CPI：PPI 缺失按 0，结果 = CPI×0.4。
  assert.ok(Math.abs(inflationAxis(null, 2) - 2 * 0.4) < 1e-9);
  // 都缺：0。
  assert.equal(inflationAxis(null, null), 0);
});

test("货币政策：M0 同比映射到 0–100，越高越松", () => {
  // M0 同比 6（TIGHT）→ 0（收紧）。
  assert.equal(monetaryStance(6).score, 0);
  // M0 同比 10（LOOSE）→ 100（宽松）。
  assert.equal(monetaryStance(10).score, 100);
  // M0 同比 8 → 中点 50。
  assert.equal(monetaryStance(8).score, 50);
  // 超界截断：12 → 仍 100，4 → 仍 0。
  assert.equal(monetaryStance(12).score, 100);
  assert.equal(monetaryStance(4).score, 0);
  // 标签：宽松 / 偏松 / 中性偏紧 / 收紧。（M0=8.5 → score=62.5 → 偏松）
  assert.equal(monetaryStance(11).label, "宽松");
  assert.equal(monetaryStance(8.5).label, "偏松");
  assert.equal(monetaryStance(7).label, "中性偏紧");
  assert.equal(monetaryStance(5).label, "收紧");
});

test("货币政策：无数据返回中性 50", () => {
  assert.equal(monetaryStance(null).score, 50);
  assert.ok(monetaryStance(null).label.includes("中性"));
});

test("空数据不报错：全空序列返回中性结果", () => {
  const res = computeClock({ pmi: [], ppi: [], cpi: [], m0: [] });
  assert.ok(Number.isNaN(res.growth.trend), "增长趋势应为 NaN");
  assert.equal(res.inflation.value, 0, "通胀应为中性 0");
  assert.equal(res.policy.monetary.score, 50, "货币应为中性 50");
  assert.equal(res.policy.fiscal.score, 50, "财政应为中性 50");
  assert.ok(res.notes.some((n) => n.includes("PMI")), "应标注增长数据不足");
  assert.ok(res.notes.some((n) => n.includes("PPI/CPI")), "应标注通胀数据不足");
  assert.ok(res.notes.some((n) => n.includes("M0")), "应标注货币数据不足");
  // 资产分仍存在（各 50 左右，因为是正中心）。
  assert.equal(res.assetScores.length, 5);
});

test("该做/不该做清单：do 是最高分两个，dont 是最低分两个", () => {
  const res = computeClock({
    pmi: pmiOf([51, 52, 53, 52, 51, 52]),
    ppi: series([3.5, 4.0]),
    cpi: series([1.8, 2.0]),
    m0: series([12]),
  });
  assert.equal(res.doDont.do.length, 2);
  assert.equal(res.doDont.dont.length, 2);
  // do 的分数应 >= dont 的分数。
  const doMin = Math.min(...res.doDont.do.map((d) => d.score));
  const dontMax = Math.max(...res.doDont.dont.map((d) => d.score));
  assert.ok(doMin >= dontMax, `do 最低 ${doMin} 应 >= dont 最高 ${dontMax}`);
});

test("资产分在 0–100 之间", () => {
  const res = computeClock({
    pmi: pmiOf([47, 53, 48, 52, 49, 51]),
    ppi: series([-3, 4]),
    cpi: series([0, 2]),
    m0: series([5, 12]),
  });
  for (const a of res.assetScores) {
    assert.ok(a.score >= 0 && a.score <= 100, `${a.name} 分 ${a.score} 超出 0–100`);
  }
});
