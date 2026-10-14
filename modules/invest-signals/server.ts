// 投资信号与趋势模块的后端：两个 /api/site 接口（信号置信度榜、行业趋势），
// 以及主题页（公司与板块）页脚的“近期走势”部件。全部数据来自公开读取层与既有统计表，
// 不调用模型；接口带弱 ETag，可按与引擎接口相同的节奏轮询。
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { latestHotRanking, rankingExtras } from "@aihot/backend/publication/hot";
import { listedCondition } from "@aihot/backend/publication/scope";
import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { confidenceOf, trendOf, trendPct, type Confidence, type TrendCounts } from "./logic.ts";

const DAY_MS = 86_400_000;
/** 信号榜与趋势的缓存：一分钟过期，撤回与重算在一分钟内对所有出口生效。 */
const CACHE_CONTROL = "public, max-age=60, s-maxage=60";

export interface SignalEntry {
  storyPublicId: string;
  title: string;
  summary: string | null;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  trendPct: number | null;
  sourceCount: number;
  participantCount: number;
  /** 精选报道方（editorial）数量，以及其中官方一手（T1）的数量。 */
  editorialCount: number;
  officialCount: number;
  confidence: Confidence;
}

export interface SignalsResponse {
  computedAt: string | null;
  windowHours: number;
  stats: {
    sources: number;
    officialSources: number;
    todayItems: number;
    activeStories: number;
    highConfidence: number;
  };
  signals: SignalEntry[];
}

export interface TrendEntry {
  tag: string;
  counts: TrendCounts;
  trend: "up" | "down" | "flat";
  changePct: number | null;
  top: { title: string; storyPublicId: string; heat: number } | null;
}

export interface TrendsResponse {
  computedAt: string;
  sectors: TrendEntry[];
}

/** 主题页部件的形状：近 7 天与前 7 天的收录条数，和最近最热的一条。 */
export interface TopicTrendPart {
  current: number;
  prior: number;
  today: number;
  top: { title: string; href: string } | null;
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

/** 北京时间“今天”的开始（站点的一切日程按 Asia/Shanghai 走）。 */
function beijingToday(now: Date): Date {
  return new Date(new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10) + "T00:00:00.000Z");
}

async function loadSignals(now: Date): Promise<SignalsResponse> {
  const ranking = await latestHotRanking();
  const from48h = new Date(now.getTime() - 48 * 3_600_000);
  const statsRows = async () => sql<{ sources: string; official: string; today: string; stories: string }[]>`
    SELECT
      (SELECT count(*) FROM sources WHERE enabled) AS sources,
      (SELECT count(*) FROM sources WHERE enabled AND tier = 'T1') AS official,
      (SELECT count(*) FROM publications p WHERE ${listedCondition(now)} AND p.timeline_at >= ${beijingToday(now)}) AS today,
      (SELECT count(DISTINCT story_id) FROM story_signals WHERE observed_at >= ${from48h}) AS stories`;
  const [stats] = await statsRows();
  if (!ranking) {
    return {
      computedAt: null,
      windowHours: 48,
      stats: { sources: Number(stats?.sources ?? 0), officialSources: Number(stats?.official ?? 0), todayItems: Number(stats?.today ?? 0), activeStories: Number(stats?.stories ?? 0), highConfidence: 0 },
      signals: [],
    };
  }
  const extras = await rankingExtras(ranking);
  const signals = ranking.entries.map((e) => {
    const participants = e.participants.map((p) => ({ kind: p.kind, tier: p.tier }));
    const editorial = participants.filter((p) => p.kind === "editorial");
    const confidence = confidenceOf(participants);
    return {
      storyPublicId: e.storyPublicId,
      title: e.title,
      summary: extras.text(e).summary,
      heat: e.heat,
      trend: e.trend,
      trendPct: e.trendPct,
      sourceCount: e.sourceCount,
      participantCount: e.participantCount,
      editorialCount: editorial.length,
      officialCount: editorial.filter((p) => p.tier === "T1").length,
      confidence,
    } satisfies SignalEntry;
  });
  signals.sort((a, b) => b.confidence.score - a.confidence.score || b.heat - a.heat);
  return {
    computedAt: ranking.computedAt,
    windowHours: 48,
    stats: {
      sources: Number(stats?.sources ?? 0),
      officialSources: Number(stats?.official ?? 0),
      todayItems: Number(stats?.today ?? 0),
      activeStories: Number(stats?.stories ?? 0),
      highConfidence: signals.filter((s) => s.confidence.level === "high").length,
    },
    signals: signals.slice(0, 20),
  };
}

async function loadTrends(now: Date): Promise<TrendsResponse> {
  const from7d = new Date(now.getTime() - 7 * DAY_MS);
  const from14d = new Date(now.getTime() - 14 * DAY_MS);
  const from48h = new Date(now.getTime() - 48 * 3_600_000);
  const rows = await sql<{ tag: string; current_7d: string; prior_7d: string; today: string; title: string | null; public_id: string | null; heat: string | null }[]>`
    WITH listed AS (
      SELECT unnest(p.tags) AS tag, p.timeline_at AS at, p.story_id
      FROM publications p
      WHERE ${listedCondition(now)}
    ), counts AS (
      SELECT tag,
        count(*) FILTER (WHERE at >= ${from7d}) AS current_7d,
        count(*) FILTER (WHERE at >= ${from14d} AND at < ${from7d}) AS prior_7d,
        count(*) FILTER (WHERE at >= ${beijingToday(now)}) AS today
      FROM listed
      GROUP BY tag
    ), top AS (
      SELECT DISTINCT ON (l.tag) l.tag, st.title, st.public_id::text AS public_id, h.heat
      FROM listed l
      JOIN stories st ON st.id = l.story_id AND st.merged_into IS NULL
      LEFT JOIN LATERAL (
        SELECT max(heat)::text AS heat FROM story_heat_hourly WHERE story_id = l.story_id AND hour >= ${from48h}
      ) h ON true
      ORDER BY l.tag, h.heat DESC NULLS LAST, l.at DESC
    )
    SELECT c.tag, c.current_7d, c.prior_7d, c.today, t.title, t.public_id, t.heat
    FROM counts c LEFT JOIN top t ON t.tag = c.tag
    WHERE c.tag = ANY(${TOPIC_TAGS}::text[])
    ORDER BY c.current_7d DESC, c.tag`;
  const sectors = rows.map((r) => {
    const counts: TrendCounts = { current: Number(r.current_7d), prior: Number(r.prior_7d), today: Number(r.today) };
    return {
      tag: r.tag,
      counts,
      trend: trendOf(counts),
      changePct: trendPct(counts),
      top: r.public_id && r.title ? { title: r.title, storyPublicId: r.public_id, heat: Number(r.heat ?? 0) } : null,
    } satisfies TrendEntry;
  });
  return { computedAt: now.toISOString(), sectors };
}

export default defineServerModule({
  name: "invest-signals",
  http(app: FastifyInstance) {
    app.get("/api/site/signals", async (req, reply) => {
      sendJson(req, reply, await loadSignals(new Date()), "sig");
    });
    app.get("/api/site/trends", async (req, reply) => {
      sendJson(req, reply, await loadTrends(new Date()), "trd");
    });
  },
  topics: {
    page: {
      /**
       * 主题页部件：这个主题近 7 天与前 7 天各收录多少条。近 7 天的成员交回引擎重读一次
       * （索引最多旧一分钟），收回与更正因此不会在页面上多留一分钟。
       */
      read(ask) {
        const from7d = ask.now.getTime() - 7 * DAY_MS;
        const from14d = ask.now.getTime() - 14 * DAY_MS;
        const todayStart = beijingToday(ask.now).getTime();
        const recent = ask.members.filter((m) => m.at.getTime() >= from7d);
        const prior = ask.members.filter((m) => m.at.getTime() >= from14d && m.at.getTime() < from7d).length;
        return {
          recheck: recent.map((m) => m.id),
          part: (current) => {
            const live = recent.flatMap((m) => current.get(m.id) ?? []);
            const top = live[0];
            return {
              current: live.length,
              prior,
              today: live.filter((m) => m.at.getTime() >= todayStart).length,
              top: top ? { title: top.title, href: `/items/${top.id}` } : null,
            } satisfies TopicTrendPart;
          },
        };
      },
    },
  },
});
