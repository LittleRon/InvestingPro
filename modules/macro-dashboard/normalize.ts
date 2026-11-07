// 页面渲染前把接口返回的数据收敛成「结构一定完整」的形状。
//
// 为什么需要：这个站点是 SSR 的，渲染体里对 payload 的任何一级解引用（例如
// payload.watchpoints.length）在字段缺失时会抛 TypeError，entry.server.tsx 直接把它
// 变成整页 500。数据库里可能留着旧版本写的记录，CDN/缓存也可能给回降级响应，
// 所以服务端出口和前端 loader 都用这一份规范化，客户端 hydration 后拉取的也走它。
//
// 这是纯函数、零依赖，服务端和浏览器 bundle 都能安全引用。

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : fallback;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** 只有能被 Date 解析的时间戳才交给渲染体；否则 new Date(...).toLocaleString() 会抛 RangeError。 */
const dateText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value)) ? value : null;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// ---------------------------------------------------------------------------
// 每日 PEST 报告
// ---------------------------------------------------------------------------

export interface SafeReportPayload {
  political: string;
  economic: string;
  social: string;
  technological: string;
  watchpoints: string[];
  snapshot: string;
}

export interface SafeReport {
  scope: string;
  at: string | null;
  model: string | null;
  payload: SafeReportPayload | null;
  missing: string | null;
  status: { job: string; status: string; at: string; error: string | null; detail: Record<string, unknown> | null } | null;
}

/** 报告记录：没有 `at` 或 payload 不完整时一律当作「还没有报告」，走空状态而不是崩溃。 */
export function safeReport(raw: unknown): SafeReport {
  const r = record(raw);
  const at = typeof r.at === "string" ? r.at : null;
  const status = r.status && typeof r.status === "object" ? {
    job: str(record(r.status).job),
    status: str(record(r.status).status),
    at: str(record(r.status).at),
    error: typeof record(r.status).error === "string" ? record(r.status).error as string : null,
    detail: r.status && typeof record(r.status).detail === "object" && record(r.status).detail !== null
      ? record(record(r.status).detail) : null,
  } : null;
  const base: SafeReport = {
    scope: str(r.scope, "CN"),
    at,
    model: typeof r.model === "string" ? r.model : null,
    payload: null,
    missing: typeof r.missing === "string" ? r.missing : null,
    status,
  };
  if (!at) return base;
  const p = record(r.payload);
  // 四象限 + watchpoints + snapshot 是渲染体一定会读的；缺任一关键项就退回空状态。
  if (Object.keys(p).length === 0) return base;
  return {
    ...base,
    payload: {
      political: str(p.political, "本日无数据"),
      economic: str(p.economic, "本日无数据"),
      social: str(p.social, "本日无数据"),
      technological: str(p.technological, "本日无数据"),
      watchpoints: strings(p.watchpoints),
      snapshot: str(p.snapshot),
    },
  };
}

// ---------------------------------------------------------------------------
// 组合配置 AI 解读
// ---------------------------------------------------------------------------

export interface SafeInterpSnapshot {
  quadrant: string;
  cycles: string;
  shortWeights: string;
  mediumWeights: string;
  longWeights: string;
  holdings: string;
  totalAssets: string;
  notes: string[];
}

export interface SafeInterpretation {
  scope: string;
  at: string;
  model: string | null;
  generation: number;
  regeneratedAt: string | null;
  payload: {
    interpretation: string;
    watchpoints: string[];
    snapshot: SafeInterpSnapshot;
  };
}

/** 解读记录：必须同时有正文、关注点和快照，否则视为「还没有解读」。 */
export function safeInterpretation(raw: unknown): SafeInterpretation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = record(raw);
  if ("missing" in r) return null;
  const p = record(r.payload);
  if (!p || Object.keys(p).length === 0) return null;
  if (typeof p.interpretation !== "string") return null;
  const s = record(p.snapshot);
  return {
    scope: str(r.scope, "CN"),
    at: str(r.at),
    model: typeof r.model === "string" ? r.model : null,
    generation: num(r.generation) || 1,
    regeneratedAt: dateText(r.regeneratedAt),
    payload: {
      interpretation: p.interpretation,
      watchpoints: strings(p.watchpoints),
      snapshot: {
        quadrant: str(s.quadrant),
        cycles: str(s.cycles),
        shortWeights: str(s.shortWeights),
        mediumWeights: str(s.mediumWeights),
        longWeights: str(s.longWeights),
        holdings: str(s.holdings),
        totalAssets: str(s.totalAssets),
        notes: strings(s.notes),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 组合配置（规则引擎结果）
// ---------------------------------------------------------------------------

export interface SafeWeight {
  key: string;
  name: string;
  weight: number;
  amount: number;
  holdings: number;
  diff: number;
}

export interface SafeAllocationResult {
  weights: SafeWeight[];
  totalAssets: number;
  notes: string[];
}

export interface SafeAllocationData {
  clock: {
    quadrantName: string;
    growth: { trend: number; label: string; at: string | null };
    inflation: { value: number; label: string; at: string | null };
  };
  cycles: { key: string; phase: "rising" | "falling" | null }[];
  allocation: SafeAllocationResult;
  horizons: Record<string, SafeAllocationResult>;
}

function safeWeights(value: unknown): SafeWeight[] {
  if (!Array.isArray(value)) return [];
  return value.filter((w): w is Record<string, unknown> => !!w && typeof w === "object").map((w) => ({
    key: str(w.key),
    name: str(w.name),
    weight: num(w.weight),
    amount: num(w.amount),
    holdings: num(w.holdings),
    diff: num(w.diff),
  }));
}

function safeResult(value: unknown): SafeAllocationResult {
  const r = record(value);
  return { weights: safeWeights(r.weights), totalAssets: num(r.totalAssets), notes: strings(r.notes) };
}

const HORIZON_KEYS = ["short", "medium", "long"] as const;

/** 组合配置：所有渲染体要读的字段都给安全默认值，接口异常时页面显示 0 而不是 500。 */
export function safeAllocation(raw: unknown): SafeAllocationData {
  const d = record(raw);
  const allocation = safeResult(d.allocation);
  const horizons: Record<string, SafeAllocationResult> = {};
  const rawHorizons = record(d.horizons);
  for (const key of HORIZON_KEYS) horizons[key] = safeResult(rawHorizons[key] ?? d.allocation);
  const clock = record(d.clock);
  const growth = record(clock.growth);
  const inflation = record(clock.inflation);
  const rawCycles = Array.isArray(d.cycles) ? d.cycles : [];
  return {
    clock: {
      quadrantName: str(clock.quadrantName, "暂无数据"),
      growth: { trend: num(growth.trend), label: str(growth.label), at: typeof growth.at === "string" ? growth.at : null },
      inflation: { value: num(inflation.value), label: str(inflation.label), at: typeof inflation.at === "string" ? inflation.at : null },
    },
    cycles: rawCycles.filter((c): c is Record<string, unknown> => !!c && typeof c === "object").map((c) => ({
      key: str(c.key),
      phase: c.phase === "rising" || c.phase === "falling" ? c.phase : null,
    })),
    allocation,
    horizons,
  };
}
