// AI 解读：对动态配置方案生成一段 AI 解读文本。读取当前时钟 + 周期 + 三视图权重 +
// 持仓，摊成快照交给模型，写好的正文和依据一起存入 macro_interpretations。
// 和 PEST 报告同一套模式：worker 调模型、入库，页面只读存储结果。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { modelFor } from "@aihot/backend/editorial/models";
import { chatJson, extractJson } from "@aihot/backend/providers/llm";
import type { ClockResult } from "./clock.ts";
import type { AllocationResult } from "./allocation.ts";
import type { CycleKey } from "./indicators.ts";

const SCOPE_NAME = "中国";

const InterpSchema = z.object({
  interpretation: z.string(),
  watchpoints: z.array(z.string()),
});

/**
 * 模型的回答如果不是 JSON，退回按标签文本读：interpretation: / watchpoints:（每个关注点一行）。
 */
export function parseInterpText(text: string): z.infer<typeof InterpSchema> {
  const lines = text.split(/\r?\n/);
  const body: string[] = [];
  const watchpoints: string[] = [];
  let inWatch = false;
  for (const raw of lines) {
    const line = raw.trim();
    const head = line.match(/^(interpretation|watchpoints)\s*[:：]\s*(.*)$/i);
    if (head) {
      const key = head[1]!.toLowerCase();
      inWatch = key === "watchpoints";
      if (head[2]!.trim()) (inWatch ? watchpoints : body).push(head[2]!.trim());
      continue;
    }
    if (!line) continue;
    if (inWatch) watchpoints.push(line.replace(/^[-*•\d.、\s]+/, "").trim());
    else body.push(line);
  }
  return {
    interpretation: body.join("\n").trim() || "（模型没有返回可用的解读文本）",
    watchpoints: watchpoints.flatMap((w) => w.split(/\n|；|;/).map((s) => s.trim())).filter(Boolean),
  };
}

let cached: { version: string; system: string; user: string } | null = null;

/** 提示词在模块自己的 prompts/ 里，版本是内容算出来的，改了就自动换版本。 */
function prompt(): { version: string; system: string; user: string } {
  if (cached) return cached;
  const system = readFileSync(new URL("./prompts/alloc-system.md", import.meta.url), "utf8").trim();
  const user = readFileSync(new URL("./prompts/alloc-user.md", import.meta.url), "utf8").trim();
  const version = createHash("sha256").update(system + "\n" + user).digest("hex").slice(0, 12);
  cached = { version, system, user };
  return cached;
}

function fmt(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function yuan(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return value.toFixed(0);
}

function weightsLine(res: AllocationResult): string {
  return res.weights.map((w) => `${w.name} ${w.weight.toFixed(1)}%（${yuan(w.amount)} 元）`).join("\n");
}

function holdingsLine(res: AllocationResult): string {
  return res.weights.map((w) => `- ${w.name}：当前 ${yuan(w.holdings)} 元，建议 ${yuan(w.amount)} 元（${w.diff >= 0 ? "建议加仓" : "建议减仓"} ${yuan(Math.abs(w.diff))} 元）`).join("\n");
}

const CYCLE_NAMES: Record<CycleKey, string> = {
  kondratiev: "长波",
  juglar: "中周期",
  kitchin: "短周期",
  kuznets: "房地产周期",
};

export interface InterpInput {
  clock: ClockResult;
  cycles: { key: CycleKey; phase: "rising" | "falling" | null }[];
  horizons: Record<"short" | "medium" | "long", AllocationResult>;
  totalAssets: number;
}

export interface StoredInterpretation {
  scope: string;
  at: string;
  model: string | null;
  payload: {
    interpretation: string;
    watchpoints: string[];
    snapshot: {
      quadrant: string;
      cycles: string;
      shortWeights: string;
      mediumWeights: string;
      longWeights: string;
      holdings: string;
      totalAssets: string;
      notes: string[];
    };
  };
}

/** 把当前配置摊成一份文本，作为解读的依据。 */
function snapshotOf(input: InterpInput): { text: string; quadrant: string } {
  const { clock, cycles, horizons, totalAssets } = input;
  const cycleLines = cycles
    .map((c) => `- ${CYCLE_NAMES[c.key]}：${c.phase === "rising" ? "上升段" : c.phase === "falling" ? "下降段" : "方向不明"}`)
    .join("\n");
  const notes = horizons.medium.notes;
  const text = [
    `象限：${clock.quadrantName}`,
    `增长轴（PMI）：${fmt(clock.growth.trend)}（${clock.growth.label}）`,
    `通胀轴（PPI×0.6 + CPI×0.4）：${fmt(clock.inflation.value)}（${clock.inflation.label}）`,
    `货币政策（M0 同比）：${clock.policy.monetary.value !== null ? fmt(clock.policy.monetary.value) : "数据不足"}（${clock.policy.monetary.label}）`,
    `财政政策（财政收入同比）：${clock.policy.fiscal.value !== null ? fmt(clock.policy.fiscal.value) : "数据不足"}（${clock.policy.fiscal.label}）`,
    ``,
    `【经济周期位置】\n${cycleLines}`,
    ``,
    `【短期权重（3–6 个月）】\n${weightsLine(horizons.short)}`,
    ``,
    `【中期权重（6–18 个月）】\n${weightsLine(horizons.medium)}`,
    ``,
    `【长期权重（1–3 年+）】\n${weightsLine(horizons.long)}`,
    ``,
    `【当前持仓】\n${holdingsLine(horizons.medium)}`,
    ``,
    `【配置说明】\n${notes.join("\n")}`,
  ].join("\n");
  return { text, quadrant: clock.quadrantName };
}

/** 生成并入库。同一天已有解读时不重复写（不重复花模型的钱）。 */
export async function composeInterpretation(input: InterpInput, at = beijingToday()): Promise<{ written: boolean; reason?: string }> {
  const [existing] = await sql<{ at: Date }[]>`SELECT at FROM macro_interpretations WHERE scope = 'CN' AND at = ${at}`;
  if (existing) return { written: false, reason: "今天已经有解读了" };

  const { text, quadrant } = snapshotOf(input);
  const p = prompt();
  const model = await modelFor("allocation_interpretation");
  const res = await chatJson({
    model,
    purpose: "macro_allocation_interpretation",
    subject: `alloc:${SCOPE_NAME}`,
    promptVersion: p.version,
    system: p.system,
    user: p.user
      .replaceAll("{quadrant}", quadrant)
      .replaceAll("{pmi}", `${fmt(input.clock.growth.trend)}（${input.clock.growth.label}）`)
      .replaceAll("{inflation}", `${fmt(input.clock.inflation.value)}（${input.clock.inflation.label}）`)
      .replaceAll("{monetary}", input.clock.policy.monetary.value !== null ? `${fmt(input.clock.policy.monetary.value)}（${input.clock.policy.monetary.label}）` : "数据不足")
      .replaceAll("{fiscal}", input.clock.policy.fiscal.value !== null ? `${fmt(input.clock.policy.fiscal.value)}（${input.clock.policy.fiscal.label}）` : "数据不足")
      .replaceAll("{cycles}", input.cycles.map((c) => `- ${CYCLE_NAMES[c.key]}：${c.phase === "rising" ? "上升段" : c.phase === "falling" ? "下降段" : "方向不明"}`).join("\n"))
      .replaceAll("{shortWeights}", weightsLine(input.horizons.short))
      .replaceAll("{mediumWeights}", weightsLine(input.horizons.medium))
      .replaceAll("{longWeights}", weightsLine(input.horizons.long))
      .replaceAll("{totalAssets}", yuan(input.totalAssets))
      .replaceAll("{holdings}", holdingsLine(input.horizons.medium))
      .replaceAll("{notes}", input.horizons.medium.notes.join("\n")),
    schema: InterpSchema,
    temperature: 0.3,
    maxTokens: 2500,
    // 推理模型有时不给 JSON；退回按标签读文本。
    parse: (content) => {
      try {
        return extractJson(content);
      } catch {
        return parseInterpText(content);
      }
    },
  });
  const payload = {
    interpretation: res.data.interpretation,
    watchpoints: res.data.watchpoints.slice(0, 3),
    snapshot: {
      quadrant: quadrant,
      cycles: input.cycles.map((c) => `${CYCLE_NAMES[c.key]}：${c.phase === "rising" ? "上升段" : c.phase === "falling" ? "下降段" : "方向不明"}`).join("\n"),
      shortWeights: weightsLine(input.horizons.short),
      mediumWeights: weightsLine(input.horizons.medium),
      longWeights: weightsLine(input.horizons.long),
      holdings: holdingsLine(input.horizons.medium),
      totalAssets: yuan(input.totalAssets),
      notes: input.horizons.medium.notes,
    },
  };
  await sql`INSERT INTO macro_interpretations (scope, at, model, payload)
    VALUES ('CN', ${at}, ${model}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (scope, at) DO NOTHING`;
  return { written: true };
}

export async function latestInterpretation(): Promise<StoredInterpretation | null> {
  const [row] = await sql<{ scope: string; at: Date; model: string | null; payload: StoredInterpretation["payload"] }[]>`
    SELECT scope, at, model, payload FROM macro_interpretations WHERE scope = 'CN' ORDER BY at DESC LIMIT 1`;
  if (!row) return null;
  return { scope: row.scope, at: new Date(row.at).toISOString().slice(0, 10), model: row.model, payload: row.payload };
}

function beijingToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
