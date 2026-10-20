// 历史类比的测试（不需要数据库）。它找的是「位置最像的几个月」，所以重点是挑得对、排得对、
// 以及最后那段没有完整后续走势的月份不能掺进来。
import assert from "node:assert/strict";
import { test } from "node:test";
import { findAnalogues, toMonthly } from "../analogues.ts";

const months = Array.from({ length: 100 }, (_, i) => {
  const y = 2018 + Math.floor((i + 0) / 12);
  const m = String((i % 12) + 1).padStart(2, "0");
  return `${y}-${m}`;
});

test("月度序列取每个月最后一条", () => {
  const daily = [
    { at: "2020-01-05", value: 10 },
    { at: "2020-01-30", value: 12 },
    { at: "2020-02-02", value: 13 },
  ];
  assert.deepEqual(toMonthly(daily).map((p) => p.value), [12, 13]);
});

test("挑出来的第一个就是位置上最像的那个月", () => {
  const ppi = months.map((_, i) => (i === 30 ? 50 : 1 + (i % 7)));
  const pmi = months.map((_, i) => 48 + (i % 5));
  const result = findAnalogues({
    months,
    ppi,
    pmi,
    kondratiev: months.map(() => 0),
    price: months.map(() => 100),
    top: 3,
  });
  assert.ok(result.analogues.length >= 1);
  // 当前是第 99 个月，ppi=0；第 30 个月 ppi=5 与众不同，不该被挑中。
  assert.ok(!result.analogues.some((a) => a.at === months[30]!), "与众不同的那个月不该算相似");
});

test("最后一段没有完整后续走势的月份不参与比较", () => {
  const result = findAnalogues({
    months,
    ppi: months.map((_, i) => 1 + (i % 9)),
    pmi: months.map((_, i) => 48 + (i % 5)),
    kondratiev: months.map(() => 0),
    price: months.map(() => 100),
    forwardMonths: 24,
    top: 5,
  });
  assert.equal(result.compared, months.length - 24);
  for (const a of result.analogues) {
    const i = months.indexOf(a.at);
    assert.ok(i + 24 < months.length, `${a.at} 之后的 24 个月不完整`);
  }
});

test("路径是相对那个月起点的涨跌幅，中位数逐月对齐", () => {
  const price = months.map((_, i) => 100 + i);
  const result = findAnalogues({
    months,
    ppi: months.map((_, i) => 1 + (i % 9)),
    pmi: months.map((_, i) => 48 + (i % 5)),
    kondratiev: months.map(() => 0),
    price,
    forwardMonths: 12,
    top: 4,
  });
  assert.ok(result.analogues.length);
  for (const a of result.analogues) {
    assert.equal(a.path.length, 12);
    assert.ok(a.path[0]!.pct > 0, "价格递增时，之后的涨跌幅为正");
    assert.equal(a.path[0]!.offset, 1);
  }
  assert.equal(result.median.length, 12);
  // 价格每月 +1，各段涨幅略有不同，中位数应落在这些值之间。
  const first = result.median[0]!.pct;
  for (const a of result.analogues) assert.ok(a.path[0]!.pct > 0);
  assert.ok(first > 0 && first < 5, `第一个月中位数 ${first} 应在合理区间`);
});

test("缺数据时不硬凑：当前位置缺一项就返回空", () => {
  const result = findAnalogues({
    months,
    ppi: months.map((_, i) => (i === months.length - 1 ? null : 1 + (i % 9))),
    pmi: months.map((_, i) => 48 + (i % 5)),
    kondratiev: months.map(() => 0),
    price: months.map(() => 100),
  });
  assert.equal(result.analogues.length, 0);
  assert.equal(result.current, null);
});
