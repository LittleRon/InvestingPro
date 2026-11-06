// 宏观仪表盘的后端：接口（仪表盘数据、周期、每日报告、时钟、动态配置、AI 解读），
// 一天三次定时任务（先采集指标，再写中美报告），两个后台队列任务（管理员从前端点按钮触发：
// 立即编写报告 + AI 解读），以及两个模型步骤（PEST + 配置解读）。
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { sessionPrincipal } from "@aihot/backend/admin/auth";
import { sql } from "@aihot/backend/db";
import { BLOCKS, CYCLES, INDICATORS, indicatorsOf, findIndicator, type BlockKey, type CountryKey, type CycleKey, type Indicator } from "./indicators.ts";
import { anchoredCycle, cycleOf, downsample, latestOf, overlayOf, sliceRange, yoyOf, type CycleSeries, type Point } from "./logic.ts";
import { findAnalogues, toMonthly, type AnalogueResult } from "./analogues.ts";
import { computeClock, type ClockResult } from "./clock.ts";
import { computeAllocation, type Horizon } from "./allocation.ts";
import { collectIndicators } from "./collect/index.ts";
import { fredConfigured } from "./collect/fred.ts";
import { marketProvider } from "./collect/market.ts";
import { composeReport, latestReport } from "./report.ts";
import { composeInterpretation, latestInterpretation } from "./interpretation.ts";

const DAY_MS = 86_400_000;
const CACHE_CONTROL = "public, max-age=300, s-maxage=300";
/** 没有给时间范围时，每个图块默认看多久。周期要看全部，因为长波本来就靠长序列。 */
const DEFAULT_YEARS: Record<BlockKey, number | null> = { cycles: null, money: 10, gold: 3, oil: 3, prices: 10, commodities: 10 };

/** 「立即编写」队列任务的一份跑完记录，写进 job_runs 让后台能查到。 */
interface ReportNowRun {
  scope: CountryKey;
  collected: number;
  written: boolean;
  reason?: string;
}

/** 「AI 解读」队列任务的一份跑完记录。 */
interface InterpRun {
  written: boolean;
  reason?: string;
}

/**
 * 「立即编写」：一个后台管理员从前端点按钮，先采集一轮再写一份报告。跑在 worker 的一个
 * 模块队列里（和定时任务分开，互不阻塞）；只有一个人能跑（singleton），重试一次。
 */
const REPORT_NOW_QUEUE = defineQueue<{ scope: CountryKey }>({
  name: "macro.report-now",
  options: { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 },
  worker: { batchSize: 1 },
  run: async (jobs) => recordRun("macro.report-now", async () => {
    const out: ReportNowRun[] = [];
    for (const job of jobs) {
      const summary = await collectIndicators();
      out.push({ scope: job.scope, collected: summary.points, ...(await composeReport(job.scope)) });
    }
    return out;
  }),
});

/**
 * 「AI 解读」队列：管理员点按钮触发，跑在 worker 的一个模块队列里。
 * 读当前时钟 + 周期 + 三视图权重，调模型写解读，存 macro_interpretations。
 * force 为真时覆盖同一天原来那条（管理员点「重新生成」）。
 */
const INTERP_QUEUE = defineQueue<{ force?: boolean }>({
  name: "macro.interp",
  options: { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 },
  worker: { batchSize: 1 },
  run: async (jobs) => recordRun("macro.interp", async () => {
    const config = await loadAllocationConfig(null);
    const data = await loadAllocation(config);
    const force = jobs.some((j) => j.force);
    const result = await composeInterpretation({
      clock: data.clock,
      cycles: data.cycles,
      horizons: data.horizons,
      totalAssets: data.allocation.totalAssets,
    }, undefined, force);
    return [{ ...result }] as InterpRun[];
  }),
});

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
  /** 数据暂未接入的周期（库兹涅茨房地产周期等）。 */
  pending: { key: CycleKey; name: string; short: string }[];
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
  /** 最近一次报告任务的运行记录（job_runs），给前端诊断「为什么还没有报告」。 */
  reportStatus: { job: string; status: string; at: string; error: string | null; detail: Record<string, unknown> | null } | null;
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
 * 四个周期的基序列。挑序列的原则是「长波段要时间跨度长，短波段要采样密」：
 *   · 长波 50–60 年，靠跨度——年度序列虽然一年一个点，但覆盖六十年，比十八年的月度序列有用；
 *   · 中周期与短周期靠密度——七到十一年、三到五年，一年一个点根本分不出来，必须月度。
 *   · 库兹涅茨房地产周期 15–25 年，用国房景气指数（2016 年起，序列偏短，shortSample 会标出来）。
 * 中国一侧没有足够长的月度实体经济序列，中周期与短周期走景气合成指数（PMI·PPI·M1 等权）。
 * 各条频率不同没关系：叠加前会统一重采样到月度网格（logic.ts 的 resampleMonthly）。
 */
const CYCLE_BASE: Record<CountryKey, Partial<Record<CycleKey, string>>> = {
  CN: { kondratiev: "cn.gdp", juglar: "cn.cli", kitchin: "cn.cli", kuznets: "cn.housing" },
  US: { kondratiev: "us.gdp", juglar: "us.fai", kitchin: "us.ind" },
};

/**
 * 叠加时各周期占多少。短周期最近当下，起伏也最快，给得最重；长波是背景，给得最轻。
 * 权重写在页面上，读者能自己核。
 */
const OVERLAY_WEIGHTS: Record<CycleKey, number> = { kitchin: 0.5, juglar: 0.3, kondratiev: 0.2, kuznets: 0.15 };

/**
 * 四个周期。滤波必须用完整序列——只拿时间范围里的一段去滤波，两端会凭空翘起来——
 * 所以这里读全序列、算完再裁到范围里。
 */
async function loadCycles(country: CountryKey, from: string | null, to: string | null, only: CycleKey | null): Promise<CyclesData> {
  const base = CYCLE_BASE[country];
  const cycles: CycleSeries[] = [];
  const pending: CyclesData["pending"] = [];
  for (const cycle of CYCLES) {
    if (only && cycle.key !== only) continue;
    const indKey = base[cycle.key];
    if (!indKey) { pending.push(cycle); continue; }
    const ind = findIndicator(indKey);
    if (!ind) { pending.push(cycle); continue; }
    const all = await pointsOf(ind.key);
    if (all.length < 8) { pending.push(cycle); continue; }
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
  // 权重按 cycles 的顺序给。短周期给得最重，长波最轻。
  const weights = cycles.map((c) => OVERLAY_WEIGHTS[c.cycle as CycleKey] ?? 1);
  return { cycles, overlay: overlayOf(cycles, weights), confirmation, note, weights: Object.fromEntries(cycles.map((c) => [c.cycle, OVERLAY_WEIGHTS[c.cycle as CycleKey] ?? 1])), pending };
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

/**
 * 美林时钟：只对中国。增长轴用制造业 PMI（月度及时），通胀轴 = PPI×0.6 + CPI×0.4，
 * 政策维度看 M0 同比 + 财政收入同比。五条序列都取最新的一段算当前位置。纯计算，不调模型。
 */
async function loadClock(): Promise<import("./clock.ts").ClockResult> {
  const [pmi, ppi, cpi, m0, fiscalRevenue] = await Promise.all([
    pointsOf("cn.pmi"),
    pointsOf("cn.ppi"),
    pointsOf("cn.cpi"),
    pointsOf("cn.m0"),
    pointsOf("cn.fiscal_revenue"),
  ]);
  return computeClock({ pmi, ppi, cpi, m0, fiscalRevenue });
}

async function loadDashboard(country: CountryKey, from: string | null, to: string | null): Promise<DashboardResponse> {
  const blocks: BlockData[] = [];
  for (const block of BLOCKS) {
    const years = DEFAULT_YEARS[block.key];
    const blockFrom = from ?? (years ? new Date(Date.now() - years * 365 * DAY_MS).toISOString().slice(0, 10) : null);
    blocks.push(await loadBlock(block.key, country, blockFrom, to));
  }
  const [cycles, report, analogues, status] = await Promise.all([
    loadCycles(country, from, to, null),
    latestReport(country),
    loadAnalogues(country),
    reportRunStatus(country),
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
    reportStatus: status,
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
      // 诊断：报告为什么还没有——最近一次任务的状态（数据不足被跳过、模型报错、从未跑过）。
      const status = await reportRunStatus(scope);
      if (report) {
        sendJson(req, reply, { ...report, status }, "rpt");
      } else {
        sendJson(req, reply, { scope, at: null, missing: "这一天的报告还没有生成", status }, "rpt");
      }
    });
    // 美林投资时钟（中国综合版）：纯计算，读 PMI/PPI/CPI/M0，不调模型。
    app.get("/api/site/dashboard/clock", async (req, reply) => {
      sendJson(req, reply, await loadClock(), "clock");
    });
    // 动态组合配置：公开计算接口（读时钟 + 周期 + 管理员配置的持仓），不调模型。
    app.get("/api/site/dashboard/allocation", async (req, reply) => {
      const admin = await sessionPrincipal(req.headers.cookie);
      const config = await loadAllocationConfig(admin?.userId ?? null);
      sendJson(req, reply, await loadAllocation(config), "alloc");
    });
    // AI 解读：公开读取最近一次的解读结果（读者打开页面不自动调模型）。
    // 不缓存：管理员重新生成后内容会变，缓存住就一直是旧的（客户端 no-store 挡不住服务端/CDN 缓存）。
    app.get("/api/site/dashboard/allocation/interpretation", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const interp = await latestInterpretation();
      reply.header("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify(interp ?? { missing: "还没有生成解读" }));
    });
    // AI 解读的生成状态：管理员点按钮后轮询这个接口，知道有没有在跑、跑完了没有。
    // 不缓存——轮询要看到最新的状态，缓存住就永远停在旧值。
    app.get("/api/site/dashboard/allocation/interpretation/status", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const interp = await latestInterpretation();
      const [run] = await sql<{ status: string; started_at: Date; error: string | null; detail: Record<string, unknown> | null }[]>`
        SELECT status, started_at, error, detail FROM job_runs WHERE job = 'macro.interp' ORDER BY started_at DESC, id DESC LIMIT 1`;
      reply.header("Content-Type", "application/json; charset=utf-8").send(JSON.stringify({
        running: run?.status === "running",
        lastStatus: run?.status ?? null,
        lastError: run?.error ?? null,
        // 客户端拿自己那份的 generation 来比，变大了就是服务器上有新的。
        generation: interp?.generation ?? 0,
        regeneratedAt: interp?.regeneratedAt ?? null,
      }));
    });
    // 管理员「立即编写」：先采集再写，跑在 worker 的一个队列里；会话 + CSRF（和 /api/admin 一致）。
    app.post("/api/admin/macro/report", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const admin = await sessionPrincipal(req.headers.cookie);
      if (!admin) return reply.code(401).send({ detail: "先登录后台" });
      if (req.headers["x-csrf-token"] !== admin.csrf) return reply.code(403).send({ detail: "CSRF token 缺失或过期" });
      const q = (req.query ?? {}) as Record<string, unknown>;
      const scope = isCountry(q.scope) ? q.scope : "CN";
      try {
        await enqueueReportNow(scope);
      } catch (error) {
        return reply.code(503).send({ detail: (error as Error).message });
      }
      return reply.code(202).send({ ok: true, scope });
    });
    // 管理员保存/读取动态配置（持仓 + 总资产 + 时效范围）。session + CSRF。
    app.get("/api/admin/macro/allocation", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const admin = await sessionPrincipal(req.headers.cookie);
      if (!admin) return reply.code(401).send({ detail: "先登录后台" });
      return reply.send(await loadAllocationConfig(admin.userId));
    });
    app.post("/api/admin/macro/allocation", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const admin = await sessionPrincipal(req.headers.cookie);
      if (!admin) return reply.code(401).send({ detail: "先登录后台" });
      if (req.headers["x-csrf-token"] !== admin.csrf) return reply.code(403).send({ detail: "CSRF token 缺失或过期" });
      if (!admin.userId) return reply.code(401).send({ detail: "开发模式不能保存配置（需要真实管理员会话）" });
      const body = (req.body ?? {}) as { totalAssets?: number; holdings?: Record<string, number>; horizon?: string };
      const totalAssets = typeof body.totalAssets === "number" ? body.totalAssets : 0;
      const holdings = body.holdings ?? {};
      const horizon = body.horizon === "short" || body.horizon === "long" ? body.horizon : "medium";
      await saveAllocationConfig(admin.userId, totalAssets, holdings, horizon as Horizon);
      return reply.send({ ok: true });
    });
    // 管理员「生成 AI 解读」：入队后立刻返回，worker 读当前配置调模型写解读。session + CSRF。
    // force=1 时覆盖同一天原来那条（重新生成）。
    app.post("/api/admin/macro/allocation/interpretation", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const admin = await sessionPrincipal(req.headers.cookie);
      if (!admin) return reply.code(401).send({ detail: "先登录后台" });
      if (req.headers["x-csrf-token"] !== admin.csrf) return reply.code(403).send({ detail: "CSRF token 缺失或过期" });
      const body = (req.body ?? {}) as { force?: boolean };
      try {
        await enqueueInterpretation(body.force === true);
      } catch (error) {
        return reply.code(503).send({ detail: (error as Error).message });
      }
      return reply.code(202).send({ ok: true });
    });
  },
  admin: {
    // 后台"运行"页的任务清单：本模块的定时任务由 cron 登记，队列任务在这里补上自己的名字。
    currentJobs: async () => ["macro.report-now", "macro.interp"],
  },
  // 每天先采集再写报告，报告写的是采集完当天的快照。报告任务自己先采一轮（stale 机制
  // 保证不重复取），这样即使 06:30 的采集还没跑完或失败，06:40 的报告也不会因数据不足被跳过。
  schedules: [
    { name: "macro.collect", cron: "30 6 * * *", missed: "once", run: () => collectIndicators() },
    { name: "macro.report", cron: "40 6 * * *", missed: "once", run: () => composeAfterCollect("CN") },
    { name: "macro.report.us", cron: "50 6 * * *", missed: "once", run: () => composeAfterCollect("US") },
  ],
  models: {
    pest: { label: "宏观仪表盘 PEST 分析（政治、经济、社会、技术）", env: "PEST_MODEL", purposes: ["macro_pest"] },
    allocation_interpretation: { label: "动态组合配置 AI 解读", env: "PEST_MODEL", purposes: ["macro_allocation_interpretation"] },
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

/** 定时任务用：先采一轮（stale 机制保证不重复取），再写报告。 */
async function composeAfterCollect(scope: CountryKey): Promise<{ collected: number; written: boolean; reason?: string }> {
  const summary = await collectIndicators();
  const result = await composeReport(scope);
  return { collected: summary.points, ...result };
}

/**
 * 管理员的「立即编写」：入队后立刻返回，worker 先采集再写。同一 scope 已有今天的报告
 * 时 composeReport 会跳过（不重复花模型的钱），队列任务本身仍记为 ok。
 */
async function enqueueReportNow(scope: CountryKey): Promise<void> {
  const id = await enqueueOn(REPORT_NOW_QUEUE, { scope });
  if (!id) throw new Error("队列拒绝了这次立即编写（可能有另一次正在跑）");
}

/** 管理员触发 AI 解读：入队后立刻返回，worker 读当前配置调模型写解读。force 时覆盖原来那条。 */
async function enqueueInterpretation(force = false): Promise<void> {
  const id = await enqueueOn(INTERP_QUEUE, { force });
  if (!id) throw new Error("队列拒绝了这次解读请求（可能有另一次正在跑）");
}

/**
 * 最近一次报告任务的运行记录（job_runs），给前端诊断「为什么还没有报告」。
 * 定时任务和「立即编写」队列都算：取两者里最新的一条。
 */
async function reportRunStatus(scope: CountryKey): Promise<{ job: string; status: string; at: string; error: string | null; detail: Record<string, unknown> | null } | null> {
  const name = scope === "US" ? "macro.report.us" : "macro.report";
  const [row] = await sql<{ job: string; status: string; started_at: Date; error: string | null; detail: Record<string, unknown> | null }[]>`
    SELECT job, status, started_at, error, detail FROM job_runs WHERE job IN (${name}, 'macro.report-now') ORDER BY started_at DESC, id DESC LIMIT 1`;
  if (!row) return null;
  return { job: row.job, status: row.status, at: new Date(row.started_at).toISOString().slice(0, 10), error: row.error, detail: row.detail };
}

/** 读取管理员的动态配置（持仓 + 总资产 + 时效范围）。没有记录时返回默认值。 */
async function loadAllocationConfig(adminId: number | null): Promise<{
  totalAssets: number;
  holdings: { stocks: number; bonds: number; commodities: number; cash: number; gold: number };
  horizon: Horizon;
  updatedAt: string | null;
}> {
  if (!adminId) return { totalAssets: 1000000, holdings: { stocks: 400000, bonds: 200000, commodities: 100000, cash: 200000, gold: 100000 }, horizon: "medium", updatedAt: null };
  const [row] = await sql<{ total_assets: number; holdings: { stocks?: number; bonds?: number; commodities?: number; cash?: number; gold?: number }; horizon: string; updated_at: Date }[]>`
    SELECT total_assets, holdings, horizon, updated_at FROM macro_allocations WHERE admin_id = ${adminId}`;
  if (!row) return { totalAssets: 1000000, holdings: { stocks: 400000, bonds: 200000, commodities: 100000, cash: 200000, gold: 100000 }, horizon: "medium", updatedAt: null };
  return {
    totalAssets: Number(row.total_assets),
    holdings: {
      stocks: Number(row.holdings?.stocks ?? 0),
      bonds: Number(row.holdings?.bonds ?? 0),
      commodities: Number(row.holdings?.commodities ?? 0),
      cash: Number(row.holdings?.cash ?? 0),
      gold: Number(row.holdings?.gold ?? 0),
    },
    horizon: row.horizon as Horizon,
    updatedAt: new Date(row.updated_at).toISOString().slice(0, 10),
  };
}

/** 保存管理员的动态配置。UPSERT 覆盖。 */
async function saveAllocationConfig(adminId: number, totalAssets: number, holdings: Record<string, number>, horizon: Horizon): Promise<void> {
  await sql`INSERT INTO macro_allocations (admin_id, total_assets, holdings, horizon, updated_at)
    VALUES (${adminId}, ${totalAssets}, ${JSON.stringify(holdings)}::jsonb, ${horizon}, now())
    ON CONFLICT (admin_id) DO UPDATE SET total_assets = excluded.total_assets, holdings = excluded.holdings, horizon = excluded.horizon, updated_at = now()`;
}

/** 计算动态配置方案：读时钟 + 周期 + 管理员配置，对三个时效范围各跑一次规则引擎。不调模型。 */
async function loadAllocation(config: { totalAssets: number; holdings: { stocks: number; bonds: number; commodities: number; cash: number; gold: number }; horizon: Horizon }): Promise<{
  clock: ClockResult;
  cycles: { key: CycleKey; phase: "rising" | "falling" | null }[];
  allocation: ReturnType<typeof computeAllocation>;
  horizons: Record<Horizon, ReturnType<typeof computeAllocation>>;
}> {
  const [clock, cycles] = await Promise.all([loadClock(), loadCycles("CN", null, null, null)]);
  const cyclePhases = cycles.cycles.map((c) => ({ key: c.cycle as CycleKey, phase: c.phase }));
  const base = { clock, cycles: cyclePhases, totalAssets: config.totalAssets, holdings: config.holdings };
  return {
    clock,
    cycles: cyclePhases,
    allocation: computeAllocation({ ...base, horizon: config.horizon }),
    horizons: {
      short: computeAllocation({ ...base, horizon: "short" as Horizon }),
      medium: computeAllocation({ ...base, horizon: "medium" as Horizon }),
      long: computeAllocation({ ...base, horizon: "long" as Horizon }),
    },
  };
}
