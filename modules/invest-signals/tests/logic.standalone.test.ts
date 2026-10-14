// 信号置信度与趋势方向的计算规则：纯函数，不连数据库。
// 置信度回答“这条消息有多可核查”，三个成分各自封顶、互不替代。
import assert from "node:assert/strict";
import { test } from "node:test";
import { confidenceOf, trendOf, trendPct } from "../logic.ts";

const editorial = (tier: string) => ({ kind: "editorial" as const, tier });
const signal = () => ({ kind: "signal" as const });

test("官方一手多家报道得到高置信度", () => {
  const c = confidenceOf([editorial("T1"), editorial("T2"), editorial("T2"), signal(), signal(), signal()]);
  // 来源 50（T1 最高档）+ 交叉 18（3 家）+ 讨论 12（6 个账号）= 80
  assert.equal(c.score, 80);
  assert.equal(c.level, "high");
  assert.deepEqual(c.parts, { evidence: 50, cross: 18, discussion: 12 });
});

test("只有媒体转载是中置信度，交叉印证封顶", () => {
  const many = Array.from({ length: 10 }, () => editorial("T2"));
  const c = confidenceOf([...many, ...Array.from({ length: 5 }, signal)]);
  assert.equal(c.parts.evidence, 26);
  assert.equal(c.parts.cross, 30);
  assert.equal(c.parts.discussion, 20);
  assert.equal(c.score, 76);
  assert.equal(c.level, "high");
});

test("没有精选报道方时来源强度取保底分，整体为待确认", () => {
  const c = confidenceOf([signal(), signal()]);
  assert.equal(c.parts.evidence, 10);
  assert.equal(c.parts.cross, 0);
  assert.equal(c.score, 14);
  assert.equal(c.level, "low");
});

test("单个官方信源也达不到高置信度：交叉印证缺失要体现在分数里", () => {
  const c = confidenceOf([editorial("T1")]);
  assert.equal(c.score, 50 + 6 + 2);
  assert.equal(c.level, "medium");
});

test("趋势方向：升温、降温、走平和从零新增", () => {
  assert.equal(trendOf({ current: 10, prior: 5, today: 2 }), "up");
  assert.equal(trendOf({ current: 4, prior: 10, today: 0 }), "down");
  assert.equal(trendOf({ current: 10, prior: 10, today: 0 }), "flat");
  assert.equal(trendOf({ current: 3, prior: 0, today: 1 }), "up");
  assert.equal(trendOf({ current: 0, prior: 0, today: 0 }), "flat");
});

test("变化幅度：没有前 7 天基数时不给百分比", () => {
  assert.equal(trendPct({ current: 4, prior: 2, today: 0 }), 100);
  assert.equal(trendPct({ current: 1, prior: 4, today: 0 }), -75);
  assert.equal(trendPct({ current: 3, prior: 0, today: 0 }), null);
});
