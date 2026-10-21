// 指标清单与数据源字段的回归测试（不需要数据库）。
//
// 货币供应那张表的字段名不直观，早先标错过一次（把 M1 当成 M0、把 M2 当成基础货币）。
// 字段按量级核对过（2026-09，单位亿元）：M0≈15.0 万亿、M1≈116.8 万亿、M2≈359.6 万亿，
// 这几个断言就是防止它再标回去。
import assert from "node:assert/strict";
import { test } from "node:test";
import { INDICATORS, DERIVED_SERIES, findIndicator } from "../indicators.ts";
import { EAST_MONEY_REPORTS } from "../collect/eastmoney.ts";

test("货币供应按量级对上 M0 / M1 / M2", () => {
  assert.equal(EAST_MONEY_REPORTS.m0.field, "FREE_CASH_SAME", "M0 是流通中现金");
  assert.equal(EAST_MONEY_REPORTS.m1.field, "CURRENCY_SAME", "M1 是狭义货币");
  assert.equal(EAST_MONEY_REPORTS.m2.field, "BASIC_CURRENCY_SAME", "M2 是广义货币");
  // 三个层次必须取三个不同的字段，标错时往往就是两个指标取了同一个字段。
  const fields = [EAST_MONEY_REPORTS.m0.field, EAST_MONEY_REPORTS.m1.field, EAST_MONEY_REPORTS.m2.field];
  assert.equal(new Set(fields).size, 3);
});

test("派生序列的两端都是清单里真实存在的指标，且排在它前面", () => {
  const order = new Map(INDICATORS.map((ind, i) => [ind.key, i]));
  for (const [derived, { left, right }] of Object.entries(DERIVED_SERIES)) {
    const key = INDICATORS.find((ind) => ind.source === "derived" && ind.series === derived)?.key;
    assert.ok(key, `清单里有 series=${derived} 的派生指标`);
    for (const side of [left, right]) {
      const at = order.get(side);
      assert.ok(at !== undefined, `${derived} 依赖的 ${side} 要在清单里`);
      // 采集按清单顺序走，源必须排在派生之前，否则第一轮派生取到的还是空表。
      assert.ok(at! < order.get(key!)!, `${side} 要排在 ${key} 之前`);
      const source = findIndicator(side)!;
      // 剪刀差两端必须同频率同口径，否则减出来没有意义。
      assert.equal(source.frequency, "M", `${side} 要是月度的`);
    }
  }
});

test("清单里的指标 key 不重复，派生指标都指向已知的派生定义", () => {
  const keys = INDICATORS.map((ind) => ind.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const ind of INDICATORS.filter((i) => i.source === "derived")) {
    assert.ok(ind.series in DERIVED_SERIES, `${ind.key} 的 series 要在 DERIVED_SERIES 里`);
  }
});
