// A daily's front-page picture comes from the item its lead is about: the editors' lead matched to an
// item by title, never simply the first highlight.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportCitation } from "@aihot/contracts/site";
import { leadItemOf } from "@aihot/backend/publication/reports";

const cite = (itemId: string, title: string, available = true) => ({ itemId, title, available }) as ReportCitation;
const arena = cite("a", "英伟达三季度数据中心营收 570 亿美元 同比增长 62%");
const sec = cite("b", "美联储暂停缩表并披露常备回购便利的操作细节，市场解读为流动性转向");

test("an editors' lead is matched to the item it is written about", () => {
  assert.equal(leadItemOf("美联储暂停缩表并披露回购操作细节", [arena, sec], [arena, sec])?.itemId, "b");
});

test("a lead that matches no item clearly has no item", () => {
  assert.equal(leadItemOf("多家央行公布利率决议，政策路径分化", [arena], [arena, sec]), undefined);
});

test("without an editors' lead the first highlight leads", () => {
  assert.equal(leadItemOf(undefined, [arena], [sec, arena])?.itemId, "a");
});

test("a withdrawn highlight never leads the front page", () => {
  const withdrawn = cite("w", "已下架", false);
  assert.equal(leadItemOf(undefined, [withdrawn, arena], [withdrawn, arena, sec])?.itemId, "a");
});
