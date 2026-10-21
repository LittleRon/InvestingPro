// 宏观仪表盘的后端：三个接口（仪表盘数据、周期、每日报告），一天两次定时任务
// （先采集指标，再写报告），以及一个 PEST 模型步骤。
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { BLOCKS, CYCLES, INDICATORS, indicatorsOf, findIndicator, type BlockKey, type CountryKey, type CycleKey, type Indicator } from "./indicators.ts";
import { anchoredCycle, cycleOf, downsample, latestOf, overlayOf, sliceRange, yoyOf, type CycleSeries, type Point } from "./logic.ts";
import { findAnalogues, toMonthly, type AnalogueResult } from "./analogues.ts";
import { collectIndicators } from "./collect/index.ts";
import { fredConfigured } from "./collect/fred.ts";
import { marketProvider } from "./collect/market.ts";
import { composeReport, latestReport } from "./report.ts";

const DAY_MS = 86_400_000;
const CACHE_CONTROL = "public, max-age=300, s-maxage=300";
/** 没有给时间范围时，每个图块默认看多久。周期要看全部，因为长波本来就靠长序列。 */
const DEFAULT_YEARS: Record<BlockKey, number | null> = { cycles: null, money: 10, gold: 3, oil: 3, prices: 10, commodities: 10 };

export interface SeriesData {
  key: string;
  name: string;
  unit: string;
  points: Point[];
  latest: { value: number; at: string } | null;
}

export interface BlockData {
  key: BlockKey;
  name: string;
  hint: string;
  series: SeriesData[];
  /** 这个图块没有可用的数据源时，页面上写给人看的那句话。 */
  unavailable: string | null;
}

export interface CyclesData {
  cycles: CycleSeries[];
  overlay: ReturnType<typeof overlayOf>;
  confirmation: SeriesData[];
  /** 中国一侧的长序列只有年度，长波位置只能是估计。 */
  note: string | null;
  /** 叠加时每个频带占多少（短周期最近当下，给得最重）。页面上要写出来。 */
  weights: Record<string, number>;
}

export interface DashboardResponse {
  computedAt: string;
  country: CountryKey;
  range: { from: string | null; to: string | null };
  blocks: BlockData[];
  cycles: CyclesData;
  /** 只有中国视图有：历史类比。 */
  analogues: AnalogueResult | null;
  sources: { fred: boolean; market: boolean; marketProvider: string | null };
  latestReport: { at: string; scope: string } | null;
}

function weakEtag(prefix: string, body: string): string {
  return `W/"${prefix}-${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
}

function sendJson(req: FastifyRequest, reply: FastifyReply, body: unknown, etagPrefix: string) {
  const text = JSON.stringify(body);
  const etag = weakEtag(etagPrefix, text);
  reply.header("ETag", etag).header("Cache-Control", CACHE_CONTROL).header("Vary", "Accept-Encoding");
  const match = (req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""));
  if (match) return reply.code(304).send();
  return reply.header("Content-Type", "application/json; charset=utf-8").send(text);
}

function isCountry(value: unknown): value is CountryKey {
  return value === "CN" || value === "US";
}

/** 只接受 YYYY-MM-DD（页面的日期输入和 URL 都是这个形状），别的当作没有传。 */
function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function pointsOf(key: string): Promise<Point[]> {
  const rows = await sql<{ at: Date; value: number }[]>`SELECT at, value FROM macro_points WHERE indicator_key = ${key} ORDER BY at`;
  return rows.map((r) => ({ at: new Date(r.at).toISOString().slice(0, 10), value: Number(r.value) }));
}

/** 取一条序列，先算同比（指数类），再按时间范围裁剪，最后降采样。 */
function shapeSeries(all: Point[], ind: Indicator, from: string | null, to: string | null): SeriesData {
  const values = ind.yoy ? yoyOf(all, ind.frequency) : all;
  const sliced = sliceRange(values, from, to);
  return {
    key: ind.key,
    name: ind.name,
    unit: ind.unit,
    points: downsample(sliced, 800),
    latest: latestOf(values),
  };
}

async function loadBlock(block: BlockKey, country: CountryKey, from: string | null, to: string | null): Promise<BlockData> {
  const meta = BLOCKS.find((b) => b.key === block)!;
  const list = indicatorsOf(block, country);
  // 行情没配 key 时，那一块整块说明原因，不画空图。
  if (block === "gold" && !marketProvider()) {
    return { key: block, name: meta.name, hint: meta.hint, series: [], unavailable: "没有配置行情 API key（Twelve Data / Polygon / Alpha Vantage 任选一个），黄金与指数基金的价格取不到" };
  }
  const series: SeriesData[] = [];
  for (const ind of list) {
    // 没配 FRED 时那几条本来就没有数据，跳过即可：一个图块里中国的序列要走东方财富，
    // 不能因为美国的取不到就整块空白。
    if (ind.source === "fred" && !fredConfigured()) continue;
    const all = await pointsOf(ind.key);
    if (!all.length) continue;
    series.push(shapeSeries(all, ind, from, to));
  }
  const missingFred = !fredConfigured() && list.some((i) => i.source === "fred");
  return {
    key: block,
    name: meta.name,
    hint: meta.hint,
    series,
    unavailable: series.length ? null : missingFred
      ? "这一块只剩需要 FRED_API_KEY 的序列，而它没有配置"
      : "还没有采到数据（第一次采集在每天 06:30）",
  };
}

/**
 * 三个周期的基序列。挑序列的原则是「长波段要时间跨度长，短波段要采样密」：
 *   · 长波 50–60 年，靠跨度——年度序列虽然一年一个点，但覆盖六十年，比十八年的月度序列有用；
 *   · 中周期与短周期靠密度——七到十一年、三到五年，一年一个点根本分不出来，必须月度。
 * 中国一侧没有足够长的月度实体经济序列，中周期与短周期走景气合成指数（PMI·PPI·M1 等权）。
 * 三条频率不同没关系：叠加前会统一重采样到月度网格（logic.ts 的 resampleMonthly）。
 */
const CYCLE_BASE: Record<CountryKey, Record<CycleKey, string>> = {
  CN: { kondratiev: "cn.gdp", juglar: "cn.cli", kitchin: "cn.cli" },
  US: { kondratiev: "us.gdp", juglar: "us.fai", kitchin: "us.ind" },
};

/**
 * 叠加时三条各占多少。短周期最近当下，起伏也最快，给得最重；长波是背景，给得最轻。
 * 权重写在页面上，读者能自己核。
 */
const OVERLAY_WEIGHTS: Record<CycleKey, number> = { kitchin: 0.5, juglar: 0.3, kondratiev: 0.2 };

/**
 * 三个周期。滤波必须用完整序列——只拿时间范围里的一段去滤波，两端会凭空翘起来——
 * 所以这里读全序列、算完再裁到范围里。
 */
async function loadCycles(country: CountryKey, from: string | null, to: string | null, only: CycleKey | null): Promise<CyclesData> {
  const base = CYCLE_BASE[country];
  const cycles: CycleSeries[] = [];
  for (const cycle of CYCLES) {
    if (only && cycle.key !== only) continue;
    const ind = findIndicator(base[cycle.key])!;
    const all = await pointsOf(ind.key);
    if (all.length < 8) continue;
    const result = cycleOf(all, ind.frequency, cycle);
    cycles.push({ ...result, points: sliceRange(result.points, from, to) });
  }
  // 技术那侧的三条印证：长波位置站不站得住，看它们。
  const confirmation: SeriesData[] = [];
  for (const ind of INDICATORS.filter((i) => i.block === "cycles" && !i.cycle && i.country === country)) {
    const all = await pointsOf(ind.key);
    if (!all.length) continue;
    confirmation.push(shapeSeries(all, ind, from, to));
  }
  const note = country === "CN"
    ? "长波用世界银行的年度实际 GDP（1960 年起，跨度够长但一年一个点）；中周期与短周期用月度景气合成指数（PMI·PPI·M1 等权标准化，约 2005 年起），一年一个点分不出三到十一年的波段"
    : "长波的末端若干年是滤波器的估计值，会随新数据修正";
  // 权重按 cycles 的顺序给（CYCLES 是长波、中周期、短周期）。
  const weights = cycles.map((c) => OVERLAY_WEIGHTS[c.cycle as CycleKey] ?? 1);
  return { cycles, overlay: overlayOf(cycles, weights), confirmation, note, weights: Object.fromEntries(cycles.map((c) => [c.cycle, OVERLAY_WEIGHTS[c.cycle as CycleKey] ?? 1])) };
}

/** 康德拉季耶夫长波的谷底锚点（清单给的是 1982 年），只用来给长期背景，中段与短段另有锚点。 */
const KONDRATIEV_TROUGHS = ["1982-01"];

/**
 * 历史类比：经济现在站在什么位置（PPI、PMI、康波背景），历史上哪些月份站得最像，
 * 那些月份之后的两年上证走过什么。只做回顾性统计，不做外推。
 */
async function loadAnalogues(country: CountryKey): Promise<AnalogueResult | null> {
  if (country !== "CN") return null;
  const [ppi, pmi, shanghai] = await Promise.all([pointsOf("cn.ppi"), pointsOf("cn.pmi"), pointsOf("cn.shanghai")]);
  if (!shanghai.length) return null;
  const price = toMonthly(shanghai);
  const months = price.map((p) => p.at.slice(0, 7));
  const pick = (points: Point[]) => {
    const m = new Map(points.map((p) => [p.at.slice(0, 7), p.value]));
    return months.map((k) => m.get(k) ?? null);
  };
  return findAnalogues({
    months,
    ppi: pick(ppi),
    pmi: pick(pmi),
    kondratiev: anchoredCycle(months.map((m) => `${m}-01`), KONDRATIEV_TROUGHS, 624),
    price: price.map((p) => p.value),
  });
}

async function loadDashboard(country: CountryKey, from: string | null, to: string | null): Promise<DashboardResponse> {
  const blocks: BlockData[] = [];
  for (const block of BLOCKS) {
    const years = DEFAULT_YEARS[block.key];
    const blockFrom = from ?? (years ? new Date(Date.now() - years * 365 * DAY_MS).toISOString().slice(0, 10) : null);
    blocks.push(await loadBlock(block.key, country, blockFrom, to));
  }
  const [cycles, report, analogues] = await Promise.all([
    loadCycles(country, from, to, null),
    latestReport(country),
    loadAnalogues(country),
  ]);
  return {
    computedAt: new Date().toISOString(),
    country,
    range: { from, to },
    blocks,
    cycles,
    analogues,
    sources: { fred: fredConfigured(), market: marketProvider() !== null, marketProvider: marketProvider() },
    latestReport: report ? { at: report.at, scope: country } : null,
  };
}

export default defineServerModule({
  name: "macro-dashboard",
  http(app: FastifyInstance) {
    app.get("/api/site/dashboard", async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const country = isCountry(q.country) ? q.country : "CN";
      sendJson(req, reply, await loadDashboard(country, isoDate(q.from), isoDate(q.to)), "dash");
    });
    app.get("/api/site/dashboard/cycles", async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const country = isCountry(q.country) ? q.country : "CN";
      const only = typeof q.cycle === "string" && CYCLES.some((c) => c.key === q.cycle) ? (q.cycle as CycleKey) : null;
      sendJson(req, reply, await loadCycles(country, isoDate(q.from), isoDate(q.to), only), "cyc");
    });
    app.get("/api/site/dashboard/report", async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const scope = isCountry(q.scope) ? q.scope : "CN";
      const at = isoDate(q.at);
      const report = at ? await reportOn(scope, at) : await latestReport(scope);
      sendJson(req, reply, report ?? { scope, at: null, missing: "这一天的报告还没有生成" }, "rpt");
    });
  },
  // 每天先采集再写报告，报告写的是采集完当天的快照。
  schedules: [
    { name: "macro.collect", cron: "30 6 * * *", missed: "once", run: () => collectIndicators() },
    { name: "macro.report", cron: "40 6 * * *", missed: "once", run: () => composeReport("CN") },
    { name: "macro.report.us", cron: "50 6 * * *", missed: "once", run: () => composeReport("US") },
  ],
  models: {
    pest: { label: "宏观仪表盘 PEST 分析（政治、经济、社会、技术）", env: "PEST_MODEL", purposes: ["macro_pest"] },
  },
});

async function reportOn(scope: CountryKey, at: string): Promise<Awaited<ReturnType<typeof latestReport>>> {
  const [row] = await sql<{ scope: string; at: Date; model: string | null; payload: Record<string, unknown> }[]>`
    SELECT scope, at, model, payload FROM macro_reports WHERE scope = ${scope} AND at = ${at}`;
  if (!row) return null;
  return {
    scope: row.scope,
    at: new Date(row.at).toISOString().slice(0, 10),
    model: row.model,
    payload: row.payload,
  } as Awaited<ReturnType<typeof latestReport>>;
}
