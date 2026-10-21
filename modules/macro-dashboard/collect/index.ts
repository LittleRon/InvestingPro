// 采集全部指标，写进模块自己的两张表。一条指标采集失败不影响别的指标，
// 结果按来源汇总成一份报告，交给定时任务记进运行记录。
import { sql } from "@aihot/backend/db";
import { COMPOSITE_SERIES, DERIVED_SERIES, INDICATORS, type CompositeKey, type DerivedKey, type Indicator } from "../indicators.ts";
import { blendOf, diffOf, type Point } from "../logic.ts";
import { fredConfigured, fetchFred } from "./fred.ts";
import { fetchWorldBank } from "./worldbank.ts";
import { fetchMarket, marketProvider } from "./market.ts";
import { fetchEastMoney, type EastMoneyKey } from "./eastmoney.ts";
import { fetchCsIndex, type CsIndexKey } from "./csindex.ts";

const DAY = 86_400_000;

/** 这条序列上次更新到现在，够不够久到该去取一次。 */
function stale(lastAt: string | null, frequency: Indicator["frequency"], now: Date): boolean {
  if (!lastAt) return true;
  const age = now.getTime() - new Date(`${lastAt}T00:00:00Z`).getTime();
  return age > ({ D: 1, W: 8, M: 35, Q: 100, A: 380 })[frequency]! * DAY;
}

/** 增量取的起点，往回留一点余量，免得数据源补发时漏掉。 */
function sinceOf(lastAt: string | null, frequency: Indicator["frequency"]): { date: string; year: number } {
  if (!lastAt) return { date: "1900-01-01", year: 1960 };
  const back = ({ D: 30, W: 60, M: 120, Q: 400, A: 800 })[frequency]! * DAY;
  const at = new Date(new Date(`${lastAt}T00:00:00Z`).getTime() - back);
  return { date: at.toISOString().slice(0, 10), year: at.getUTCFullYear() };
}

async function lastPointAt(key: string): Promise<string | null> {
  const [row] = await sql<{ at: Date }[]>`
    SELECT at FROM macro_points WHERE indicator_key = ${key} ORDER BY at DESC LIMIT 1`;
  return row ? new Date(row.at).toISOString().slice(0, 10) : null;
}

/** 一条已入库序列的全部点，按时间正序。 */
async function allPointsOf(key: string): Promise<Point[]> {
  const rows = await sql<{ at: Date; value: number }[]>`SELECT at, value FROM macro_points WHERE indicator_key = ${key} ORDER BY at`;
  return rows.map((r) => ({ at: new Date(r.at).toISOString().slice(0, 10), value: Number(r.value) }));
}

/** 一条合成序列：几条已入库的月度指标标准化后加权平均（算法在 logic.ts 的 blendOf）。 */
async function compositeOf(key: CompositeKey): Promise<Point[]> {
  const { parts } = COMPOSITE_SERIES[key];
  const lists = await Promise.all(parts.map((p) => allPointsOf(p.key)));
  return blendOf(lists.map((points, i) => ({ points, weight: parts[i]!.weight })));
}

/**
 * 一条派生序列：两条已入库的序列逐月相减（逻辑在 logic.ts 的 diffOf）。两侧都不存在时没有点，
 * 采集会跳过；每轮都重算，因为它依赖的那两条可能刚在这一轮更新过。
 */
async function derivedOf(key: DerivedKey): Promise<Point[]> {
  const { left, right } = DERIVED_SERIES[key];
  const [l, r] = await Promise.all([allPointsOf(left), allPointsOf(right)]);
  return diffOf(l, r);
}

/** 一批点写库：同一时点后来的值覆盖先前的（数据源会修订历史）。 */
async function savePoints(key: string, points: Point[]): Promise<void> {
  if (!points.length) return;
  for (let i = 0; i < points.length; i += 2000) {
    const chunk = points.slice(i, i + 2000);
    const keys = chunk.map(() => key);
    const ats = chunk.map((p) => p.at);
    const values = chunk.map((p) => p.value);
    await sql`INSERT INTO macro_points (indicator_key, at, value)
      SELECT * FROM unnest(${keys}::text[], ${ats}::date[], ${values}::float8[])
      ON CONFLICT (indicator_key, at) DO UPDATE SET value = excluded.value`;
  }
}

async function saveIndicator(ind: Indicator): Promise<void> {
  await sql`INSERT INTO macro_indicators (key, block, country, name, unit, frequency, source, series, cycle, updated_at)
    VALUES (${ind.key}, ${ind.block}, ${ind.country}, ${ind.name}, ${ind.unit}, ${ind.frequency}, ${ind.source}, ${ind.series}, ${ind.cycle ?? null}, now())
    ON CONFLICT (key) DO UPDATE SET block = excluded.block, country = excluded.country, name = excluded.name,
      unit = excluded.unit, frequency = excluded.frequency, source = excluded.source, series = excluded.series,
      cycle = excluded.cycle, updated_at = now()`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 取一条指标的新数据。来源缺 key 或者数据源不收这个代码时，抛出的错就是说给人听的那句。 */
async function pull(ind: Indicator, lastAt: string | null): Promise<Point[]> {
  const { date, year } = sinceOf(lastAt, ind.frequency);
  if (ind.source === "fred") return fetchFred(ind.series, lastAt ? date : undefined);
  if (ind.source === "worldbank") return fetchWorldBank(ind.series, lastAt ? year : undefined);
  if (ind.source === "eastmoney") return fetchEastMoney(ind.series as EastMoneyKey);
  if (ind.source === "csindex") return fetchCsIndex(ind.series as CsIndexKey);
  if (ind.source === "derived") return derivedOf(ind.series as DerivedKey);
  if (ind.source === "composite") return compositeOf(ind.series as CompositeKey);
  // 行情接口按分钟限流（Twelve Data 每分钟 8 次，Alpha Vantage 每分钟 5 次），
  // 一条一条来，间隔取两家都够用的 12 秒。
  await sleep(12000);
  return fetchMarket(ind.series, date);
}

export interface CollectSummary {
  updated: string[];
  skipped: number;
  failed: { key: string; reason: string }[];
  points: number;
}

/** 采集一轮：一条一条串行，失败的记下来继续。 */
export async function collectIndicators(now = new Date()): Promise<CollectSummary> {
  const summary: CollectSummary = { updated: [], skipped: 0, failed: [], points: 0 };
  const fred = fredConfigured();
  const market = marketProvider();
  for (const ind of INDICATORS) {
    if (ind.source === "fred" && !fred) { summary.failed.push({ key: ind.key, reason: "FRED_API_KEY 未配置" }); continue; }
    if (ind.source === "market" && !market) { summary.skipped++; continue; }
    const lastAt = await lastPointAt(ind.key);
    // 派生与合成序列每轮都重算：它们不发请求，成本只是读几张已入库的表，
    // 而它们依赖的那几条可能刚在这一轮更新过。
    if (ind.source !== "derived" && ind.source !== "composite" && !stale(lastAt, ind.frequency, now)) { summary.skipped++; continue; }
    try {
      const points = await pull(ind, lastAt);
      if (!points.length) { summary.skipped++; continue; }
      await saveIndicator(ind);
      await savePoints(ind.key, points);
      summary.updated.push(ind.key);
      summary.points += points.length;
    } catch (error) {
      summary.failed.push({ key: ind.key, reason: (error as Error).message.slice(0, 160) });
    }
  }
  return summary;
}
