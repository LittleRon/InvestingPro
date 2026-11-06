// 模型输出的兜底解析：JSON 抽取（带推理字段、散文包裹、括号配对）与按标签读文本。
// 这些是模型不按 JSON 模式回答时报告仍然能写出来的关键。
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson } from "@aihot/backend/providers/llm";
import { parsePestText } from "../report.ts";
import { parseInterpText } from "../interpretation.ts";

test("extractJson: 纯 JSON 对象原样取出", () => {
  const data = extractJson('{"a":1,"b":[2,3]}') as Record<string, unknown>;
  assert.equal(data.a, 1);
  assert.deepEqual(data.b, [2, 3]);
});

test("extractJson: Markdown 代码块包裹的 JSON", () => {
  const data = extractJson('```json\n{"a":"x"}\n```') as Record<string, unknown>;
  assert.equal(data.a, "x");
});

test("extractJson: 散文前后包裹时按括号深度配对，不被散文里的括号带偏", () => {
  const text = '好的，这是结果 {不是 JSON 的部分}：\n{"a":"v"}\n希望有帮助';
  const data = extractJson(text) as Record<string, unknown>;
  assert.equal(data.a, "v");
});

test("extractJson: 字符串里的花括号不影响配对", () => {
  const data = extractJson('{"a":"含有 } 和 { 的文字","b":2}') as Record<string, unknown>;
  assert.equal(data.a, "含有 } 和 { 的文字");
  assert.equal(data.b, 2);
});

test("extractJson: 没有 JSON 时报错并带预览", () => {
  assert.throws(() => extractJson("模型只说了些废话"), /No JSON object/);
});

test("parsePestText: 按标签读出四个象限与关注要点", () => {
  const text = [
    "political: 财政政策保持积极。",
    "economic: CPI 同比 0.5%，PPI 同比 -1.2%。",
    "social: 本日无数据",
    "technological: 研发投入强度持平。",
    "watchpoints:",
    "- 下一期 PPI 与 CPI 差值",
    "- 财政收入增速变化",
  ].join("\n");
  const out = parsePestText(text);
  assert.equal(out.political, "财政政策保持积极。");
  assert.equal(out.economic, "CPI 同比 0.5%，PPI 同比 -1.2%。");
  assert.equal(out.social, "本日无数据");
  assert.equal(out.technological, "研发投入强度持平。");
  assert.equal(out.watchpoints.length, 2);
  assert.match(out.watchpoints[0]!, /PPI/);
});

test("parsePestText: 标签后多行的段落归到一起，缺项写「本日无数据」", () => {
  const text = [
    "political: 第一行。",
    "第二行仍在政治象限。",
    "economic: 只有经济有数据。",
  ].join("\n");
  const out = parsePestText(text);
  assert.equal(out.political, "第一行。\n第二行仍在政治象限。");
  assert.equal(out.economic, "只有经济有数据。");
  assert.equal(out.social, "本日无数据");
  assert.equal(out.technological, "本日无数据");
});

test("parseInterpText: 读出正文与关注点", () => {
  const text = [
    "interpretation: 当前处于复苏象限，建议关注权益资产。",
    "watchpoints:",
    "- PMI 趋势是否延续",
    "- PPI 何时转正",
  ].join("\n");
  const out = parseInterpText(text);
  assert.match(out.interpretation, /复苏象限/);
  assert.equal(out.watchpoints.length, 2);
});
