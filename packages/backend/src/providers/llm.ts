// OpenAI-compatible chat calls, always through receipts. One model is enough: `default` is whatever the
// deployment names in LLM_BASE_URL / LLM_API_KEY / LLM_MODEL, and every capability uses it unless the
// site, an environment variable or the admin's model page picks one of the site's named presets
// (site/models.ts).
import type { z } from "zod";
import { PRESETS } from "@aihot/site/models";
import { config, credential } from "../config.ts";
import { sha256 } from "../lib/ids.ts";
import { assertAccepted, paidRequest, ProviderRejectedError, rejectReceivedResponse } from "./receipts.ts";

export interface ModelSpec {
  key: string;
  service: string;
  model: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  /** 地址与密钥的直接值（环境变量登记的模型用）；没有就走 baseUrlEnv / apiKeyEnv。 */
  baseUrl?: string | null;
  apiKey?: string | null;
  /** Extra request fields, e.g. switching reasoning off for short structured tasks. */
  extra?: Record<string, unknown>;
  /** Output tokens added to every call's own limit for a reasoning model, which reasons before it answers. */
  reasoningTokens?: number;
  jsonMode: boolean;
  vision?: boolean;
}

function extraFromEnv(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error("LLM_EXTRA_JSON must be a JSON object, e.g. {\"enable_thinking\": false}");
  }
}

function reasoningTokensFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("LLM_REASONING_TOKENS must be a non-negative integer, e.g. 4000");
  return Number(value);
}

/**
 * 部署时用环境变量登记的额外模型。格式是每行一条 JSON：
 *
 *   LLM_EXTRA_MODELS={"my-key":{"service":"deepseek","model":"deepseek-flash","baseUrl":"https://api.deepseek.com/v1","apiKeyEnv":"DEEPSEEK_API_KEY_2","jsonMode":true}}
 *
 * 同一家厂家、同一个模型、不同密钥，就登记两条（key 名不同、apiKeyEnv 不同），后台就能分别选。
 * 密钥本身不写在这里，写 apiKeyEnv 指的环境变量名。
 */
export interface ExtraModelSpec {
  service: string;
  model: string;
  /** 直接写地址；不写就用 baseUrlEnv 指的环境变量。 */
  baseUrl?: string;
  baseUrlEnv?: string;
  /** 密钥放哪个环境变量（推荐）；也可以直接写 apiKey（不推荐，会进日志）。 */
  apiKeyEnv?: string;
  apiKey?: string;
  extra?: Record<string, unknown>;
  reasoningTokens?: number;
  jsonMode?: boolean;
  vision?: boolean;
}

function extraModelsFromEnv(): Record<string, ExtraModelSpec> {
  const raw = process.env.LLM_EXTRA_MODELS;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LLM_EXTRA_MODELS must be a JSON object, e.g. {\"my-key\":{\"service\":\"...\",\"model\":\"...\",\"baseUrl\":\"...\",\"apiKeyEnv\":\"...\"}}");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM_EXTRA_MODELS must be a JSON object keyed by model name");
  }
  const out: Record<string, ExtraModelSpec> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const spec = value as Partial<ExtraModelSpec>;
    if (!spec.service || !spec.model) throw new Error(`LLM_EXTRA_MODELS entry "${key}" needs both service and model`);
    if (!spec.baseUrl && !spec.baseUrlEnv) throw new Error(`LLM_EXTRA_MODELS entry "${key}" needs baseUrl or baseUrlEnv`);
    if (!spec.apiKeyEnv && !spec.apiKey) throw new Error(`LLM_EXTRA_MODELS entry "${key}" needs apiKeyEnv or apiKey`);
    out[key] = {
      service: spec.service,
      model: spec.model,
      baseUrl: spec.baseUrl,
      baseUrlEnv: spec.baseUrlEnv,
      apiKeyEnv: spec.apiKeyEnv,
      apiKey: spec.apiKey,
      extra: spec.extra,
      reasoningTokens: spec.reasoningTokens,
      jsonMode: spec.jsonMode !== false,
      vision: spec.vision === true,
    };
  }
  return out;
}

/** 环境变量登记的模型的名字（LLM_EXTRA_MODELS 里的键）。读不到时只留空，不报错。 */
export function extraModelKeys(): Record<string, ExtraModelSpec> {
  try {
    return extraModelsFromEnv();
  } catch {
    return {};
  }
}

/**
 * 环境变量登记的模型，键是登记时用的名字。读不到时只留空，不报错（部署时给的才是准的）。
 */
function extraModels(): Record<string, ModelSpec> {
  let specs: Record<string, ExtraModelSpec>;
  try {
    specs = extraModelsFromEnv();
  } catch {
    return {};
  }
  return Object.fromEntries(Object.entries(specs).map(([key, s]) => [key, {
    key,
    service: s.service,
    model: s.model,
    baseUrlEnv: s.baseUrlEnv ?? "",
    apiKeyEnv: s.apiKeyEnv ?? "",
    // 直接写在登记里的地址与密钥：baseUrl 优先于环境变量。
    get baseUrl() { return s.baseUrl ?? credential("models", s.baseUrlEnv ?? ""); },
    get apiKey() { return s.apiKey ?? credential("models", s.apiKeyEnv ?? ""); },
    get extra() { return s.extra; },
    get reasoningTokens() { return s.reasoningTokens; },
    get jsonMode() { return s.jsonMode !== false; },
    get vision() { return s.vision === true; },
  }]));
}

/**
 * LLM_EXTRA_MODELS 写错时的原因（JSON 语法错、缺字段等）。读不到或写对时是 null。
 * 后台「可用的模型」列表把它显示出来——写错了却没有任何提示，最难查。
 */
export function extraModelsError(): string | null {
  try {
    extraModelsFromEnv();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export const MODELS: Record<string, ModelSpec> = {
  // Read from the environment at call time.
  default: {
    key: "default", service: "llm", baseUrlEnv: "LLM_BASE_URL", apiKeyEnv: "LLM_API_KEY",
    get model() { return process.env.LLM_MODEL ?? ""; },
    get extra() { return extraFromEnv(process.env.LLM_EXTRA_JSON); },
    get reasoningTokens() { return reasoningTokensFromEnv(process.env.LLM_REASONING_TOKENS); },
    get jsonMode() { return process.env.LLM_JSON_MODE !== "false"; },
    get vision() { return process.env.LLM_VISION === "true"; },
  },
  // The pack's named presets, each with its own address and key.
  ...Object.fromEntries(Object.entries(PRESETS).map(([key, preset]) => [key, { key, ...preset }])),
  // Models the deployment registered through the environment.
  ...extraModels(),
};

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatJsonOptions<S extends z.ZodType> {
  model: string;
  purpose: string;
  subject: string;
  promptVersion: string;
  system: string;
  user: string | ContentPart[];
  schema: S;
  temperature?: number;
  maxTokens?: number;
  attemptTag?: string;
  timeoutMs?: number;
  /** false: the model answers in its own text format (no JSON mode); `parse` turns it into the schema's input. */
  json?: boolean;
  parse?: (content: string) => unknown;
}

export interface ChatJsonResult<T> {
  data: T;
  receiptId: number;
  reused: boolean;
  model: string;
  usage: Record<string, unknown> | null;
}

export class ModelOutputError extends Error {
  readonly receiptId: number | null;
  constructor(message: string, receiptId: number | null = null) {
    super(message);
    this.receiptId = receiptId;
  }
}

/**
 * Pulls the JSON object out of a model answer. Models often wrap the object in prose or a Markdown
 * fence, and prose can itself contain braces, so every "{" is tried as a candidate start and the
 * braces are matched by depth (ignoring braces inside strings). The first candidate that parses wins.
 */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1]!.trim();

  let sawBrace = false;
  for (let start = t.indexOf("{"); start !== -1; start = t.indexOf("{", start + 1)) {
    sawBrace = true;
    // Match braces by depth, ignoring braces inside strings.
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < t.length; i++) {
      const ch = t[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;
    const body = t.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch {
      try {
        return JSON.parse(escapeControlCharsInStrings(body));
      } catch {
        // Not valid JSON from here; try the next "{" (the prose may have held a brace pair).
      }
    }
  }
  const reason = sawBrace ? "Unbalanced or invalid JSON" : "No JSON object";
  throw new ModelOutputError(`${reason} in model output (got ${text.length} chars: ${JSON.stringify(text.slice(0, 200))})`);
}

/** Models sometimes emit raw newlines or tabs inside JSON strings (multi-line posts); escape only those. */
export function escapeControlCharsInStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch < " ") {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function isConnectFailure(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"].includes(code ?? "");
}

export async function chatJson<S extends z.ZodType>(opts: ChatJsonOptions<S>): Promise<ChatJsonResult<z.infer<S>>> {
  const spec = MODELS[opts.model];
  if (!spec) throw new Error(`Unknown model ${opts.model}`);
  if (!config.modelCallsEnabled) throw new Error("Model calls are disabled (MODEL_CALLS_ENABLED=false)");
  const baseUrl = spec.baseUrl ?? credential("models", spec.baseUrlEnv);
  const apiKey = spec.apiKey ?? credential("models", spec.apiKeyEnv);
  if (!baseUrl || !apiKey || !spec.model) {
    // 说出缺哪一项：环境变量登记的模型报它自己的地址与密钥变量名。
    const missing = [
      !spec.model ? "model" : null,
      !baseUrl ? (spec.baseUrlEnv || "baseUrl") : null,
      !apiKey ? (spec.apiKeyEnv || "apiKey") : null,
    ].filter(Boolean).join(", ");
    throw new Error(`Model ${opts.model} is not configured (missing: ${missing}${spec.key === "default" ? ", LLM_MODEL" : ""})`);
  }

  const temperature = opts.temperature ?? 0.2;
  const maxTokens = Math.max(opts.maxTokens ?? 1500, 512) + (spec.reasoningTokens ?? 0);
  const userText = typeof opts.user === "string" ? opts.user : JSON.stringify(opts.user);
  const body: Record<string, unknown> = {
    model: spec.model,
    messages: [
      // A prompt given as one user message (the title/summary prompts) has no system message.
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      // Multimodal parts go through as parts; plain objects are sent as JSON text.
      { role: "user", content: typeof opts.user === "string" || Array.isArray(opts.user) ? opts.user : userText },
    ],
    temperature,
    max_tokens: maxTokens,
    ...(spec.jsonMode && opts.json !== false ? { response_format: { type: "json_object" } } : {}),
    ...(spec.extra ?? {}),
  };

  const receipt = await paidRequest(
    {
      service: spec.service,
      model: spec.model,
      purpose: opts.purpose,
      subject: opts.subject,
      identity: { model: spec.model, promptVersion: opts.promptVersion, system: sha256(opts.system), user: sha256(userText), temperature, maxTokens, extra: spec.extra ?? null },
      requestSummary: { promptVersion: opts.promptVersion, systemHash: sha256(opts.system), userHash: sha256(userText), userChars: userText.length, temperature, maxTokens },
      attemptTag: opts.attemptTag,
    },
    async () => {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
      } catch (error) {
        if (isConnectFailure(error)) throw new ProviderRejectedError(`connect failed: ${String(error)}`, null, true);
        throw error;
      }
      const text = await res.text();
      assertAccepted(spec.service, res.status, text);
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Expected a response object");
      } catch {
        json = { unparsable: text.slice(0, 20000) };
      }
      const usage = (json.usage as Record<string, unknown> | undefined) ?? null;
      return {
        response: { ...json, _latencyMs: Date.now() - started },
        requestId: (json.id as string | undefined) ?? res.headers.get("x-request-id"),
        usage,
        cost: null,
      };
    },
  );

  const response = receipt.response as {
    choices?: Array<{
      message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
      finish_reason?: string;
    }>;
    usage?: Record<string, unknown>;
  };
  const choice = response.choices?.[0];
  const message = choice?.message;
  // Reasoning models (DeepSeek-R1, QwQ, GLM thinking) put their chain of thought in a side field and can
  // leave the answer empty or wrap it in prose. Try the answer first, then every reasoning field, then
  // look for a JSON object anywhere in what came back.
  const candidates = [
    message?.content ?? "",
    message?.reasoning_content ?? "",
    message?.reasoning ?? "",
  ];
  // Try each candidate until one parses into the schema.
  let parsed: z.infer<S> | undefined;
  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      parsed = opts.schema.parse(opts.parse ? opts.parse(candidate) : extractJson(candidate));
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (parsed === undefined) {
    // Unusable output: record it and let a later attempt pay for a fresh answer. A reasoning model that
    // reasoned up to the output limit leaves an empty or cut-off answer; say so, and where to give it room.
    const raw = candidates.find((c) => c.trim()) ?? "";
    const detail = choice?.finish_reason === "length"
      ? `output token limit reached (finish_reason=length): a reasoning model may have spent it reasoning; give it room with ${spec.key === "default" ? "LLM_REASONING_TOKENS" : `reasoningTokens on preset ${spec.key}`}. ${String(lastError)}`
      : `${String(lastError)} (model returned ${raw.length} chars: ${JSON.stringify(raw.slice(0, 200))})`;
    await rejectReceivedResponse(receipt.receiptId, `unusable output: ${detail.slice(0, 500)}`);
    throw new ModelOutputError(`Model ${opts.model} returned unusable output for ${opts.subject}: ${detail.slice(0, 300)}`, receipt.receiptId);
  }
  return { data: parsed, receiptId: receipt.receiptId, reused: receipt.reused, model: spec.key, usage: response.usage ?? null };
}
