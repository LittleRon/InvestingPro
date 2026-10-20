// 每天一份的 PEST 报告：先把当天各图块的读数和三个周期的位置摊成一份快照，
// 再把快照交给模型按四个象限写，写好的正文和它的依据一起存下来（读者可以核对）。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { modelFor } from "@aihot/backend/editorial/models";
import { chatJson } from "@aihot/backend/providers/llm";
import { BLOCKS, type CountryKey } from "./indicators.ts";
import { cycleOf, latestOf, yoyOf, type Point } from "./logic.ts";

const SCOPE_NAME: Record<CountryKey, string> = { CN: "中国", US: "美国" };

const PestSchema = z.object({
  political: z.string(),
  economic: z.string(),
  social: z.string(),
  technological: z.string(),
  watchpoints: z.array(z.string()),
});

let cached: { version: string; system: string; user: string } | null = null;

/** 提示词在模块自己的 prompts/ 里，版本是内容算出来的，改了就自动换版本。 */
function prompt(): { version: string; system: string; user: string } {
  if (cached) return cached;
  const system = readFileSync(new URL("./prompts/pest-system.md", import.meta.url), "utf8").trim();
  const user = readFileSync(new URL("./prompts/pest-user.md", import.meta.url), "utf8").trim();
  const version = createHash("sha256").update(system + "\n" + user).digest("hex").slice(0, 12);
  cached = { version, system, user };
  return cached;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function num(value: number): string {
  if (Math.abs(value) >= 10000) return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  return value.toFixed(2);
}

/** 一条序列的当期读数，写成给模型看的一行。 */
function line(name: string, points: Point[], unit: string, yoy: boolean): string | null {
  const all = yoy ? yoyOf(points, "M") : points;
  const latest = latestOf(all);
  if (!latest) return null;
  return `${name}：${yoy ? pct(latest.value) : num(latest.value)}${unit ? ` ${unit}` : ""}（${latest.at}）`;
}

/** 把当天所有能拿到的数据摊成一份文本，报告的依据和它一起存，读者可以核对。 */
export async function snapshotOf(scope: CountryKey, at: string): Promise<{ text: string; count: number }> {
  const rows = await sql<{ indicator_key: string; at: Date; value: number }[]>`
    SELECT p.indicator_key, p.at, p.value FROM macro_points p
    JOIN macro_indicators i ON i.key = p.indicator_key
    WHERE i.country = ${scope} OR i.country = 'GLOBAL'
    ORDER BY p.indicator_key, p.at DESC`;
  const byKey = new Map<string, Point[]>();
  for (const row of rows) {
    const list = byKey.get(row.indicator_key) ?? [];
    list.push({ at: new Date(row.at).toISOString().slice(0, 10), value: Number(row.value) });
    byKey.set(row.indicator_key, list);
  }
  for (const list of byKey.values()) list.sort((a, b) => (a.at < b.at ? -1 : 1));

  const meta = await sql<{ key: string; name: string; unit: string; frequency: string; yoy: boolean | null; block: string; cycle: string | null }[]>`
    SELECT key, name, unit, frequency, (key LIKE ANY(ARRAY['%cpi%', '%ppi%'])) AS yoy, block, cycle
    FROM macro_indicators WHERE country = ${scope} OR country = 'GLOBAL'`;

  const sections: string[] = [];
  let count = 0;
  for (const block of BLOCKS) {
    const lines: string[] = [];
    for (const m of meta.filter((x) => x.block === block.key)) {
      const text = line(m.name, byKey.get(m.key) ?? [], m.unit, m.yoy ?? false);
      if (text) { lines.push(text); count++; }
    }
    if (lines.length) sections.push(`【${block.name}】\n${lines.join("\n")}`);
  }

  // 三个周期各自在哪里，是这份报告里最需要交代的一件事。
  const base: Record<string, { key: string; frequency: "M" | "Q" | "A" }> = scope === "CN"
    ? { 长波: { key: "cn.gdp", frequency: "A" }, 中周期: { key: "cn.fai", frequency: "A" }, 短周期: { key: "cn.ind", frequency: "A" } }
    : { 长波: { key: "us.gdp", frequency: "Q" }, 中周期: { key: "us.fai", frequency: "Q" }, 短周期: { key: "us.ind", frequency: "M" } };
  const bands = [["长波", 50, 60], ["中周期", 7, 11], ["短周期", 3, 5]] as const;
  const cycleLines: string[] = [];
  for (const [label, low, high] of bands) {
    const spec = base[label]!;
    const points = byKey.get(spec.key) ?? [];
    if (points.length < 8) continue;
    const result = cycleOf(points, spec.frequency, { key: label, name: label, short: label, lowYears: low, highYears: high });
    if (result.latest === null) continue;
    const phase = result.phase === "rising" ? "上升段" : result.phase === "falling" ? "下降段" : "方向不明";
    const tail = result.shortSample ? "；序列比一个完整周期还短，位置仅供参考" : result.provisionalFrom ? "；末端为滤波估计值" : "";
    cycleLines.push(`${label}（${low}–${high}年）：当前 ${pct(result.latest)}，${phase}${tail}`);
    count++;
  }
  if (cycleLines.length) sections.push(`【经济周期位置】\n${cycleLines.join("\n")}`);
  return { text: sections.join("\n\n"), count };
}

export interface StoredReport {
  scope: string;
  at: string;
  model: string | null;
  payload: {
    political: string;
    economic: string;
    social: string;
    technological: string;
    watchpoints: string[];
    snapshot: string;
  };
}

/** 生成并入库。数据不够就根本不叫模型，免得写一份没有依据的报告。 */
export async function composeReport(scope: CountryKey, at = beijingToday()): Promise<{ written: boolean; reason?: string }> {
  const { text, count } = await snapshotOf(scope, at);
  if (count < 4) return { written: false, reason: `只有 ${count} 项数据，不够写报告` };
  const [existing] = await sql<{ at: Date }[]>`SELECT at FROM macro_reports WHERE scope = ${scope} AND at = ${at}`;
  if (existing) return { written: false, reason: "这一天已经有报告了" };
  const p = prompt();
  const model = await modelFor("pest");
  const res = await chatJson({
    model,
    purpose: "macro_pest",
    subject: `pest:${scope}`,
    promptVersion: p.version,
    system: p.system,
    user: p.user.replaceAll("{scopeName}", SCOPE_NAME[scope]).replaceAll("{at}", at).replaceAll("{snapshot}", text),
    schema: PestSchema,
    temperature: 0.2,
    maxTokens: 2000,
  });
  const payload = {
    political: res.data.political,
    economic: res.data.economic,
    social: res.data.social,
    technological: res.data.technological,
    watchpoints: res.data.watchpoints.slice(0, 4),
    snapshot: text,
  };
  await sql`INSERT INTO macro_reports (scope, at, model, payload)
    VALUES (${scope}, ${at}, ${model}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (scope, at) DO NOTHING`;
  return { written: true };
}

export async function latestReport(scope: CountryKey): Promise<StoredReport | null> {
  const [row] = await sql<{ scope: string; at: Date; model: string | null; payload: StoredReport["payload"] }[]>`
    SELECT scope, at, model, payload FROM macro_reports WHERE scope = ${scope} ORDER BY at DESC LIMIT 1`;
  if (!row) return null;
  return { scope: row.scope, at: new Date(row.at).toISOString().slice(0, 10), model: row.model, payload: row.payload };
}

/** 北京的今天（站点的一切日程按北京时间走）。 */
function beijingToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
