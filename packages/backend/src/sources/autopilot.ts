// Automatic collection on the schedule, and one round on demand.
//
// Two different valves, kept apart on purpose:
//   · COLLECT_ENABLED (environment, read by the worker) decides whether the worker registers collection
//     at all. Turning it off means a restart and no fetch jobs whatsoever, including manual ones.
//   · This switch (settings row `collection.autopilot`, read at run time) is the operator's: it pauses
//     the collection schedules without a restart, while manual rounds and a single source's
//     "立即采集" keep working. That is the point of it — stop the meter, then fetch when you mean to.
//
// Processing (analysis, grouping, digests, reports) is not collection and is never paused: material
// already stored still has to finish, and the ingest API keeps working.
import { sql } from "../db.ts";
import { audit } from "../audit.ts";
import { scheduleDueSources } from "./collect.ts";

export const AUTOPILOT_KEY = "collection.autopilot";

/** Short enough that a switch applies to the worker's next run, long enough to spare a query a second. */
const CACHE_MS = 15_000;

let cache: { at: number; enabled: boolean } | null = null;

export function invalidateAutopilot(): void {
  cache = null;
}

/** Whether the collection schedules may fetch. Unset means on: pausing takes an explicit switch. */
export async function autoCollectEnabled(): Promise<boolean> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.enabled;
  const [row] = await sql<{ value: { enabled?: boolean } }[]>`SELECT value FROM settings WHERE key = ${AUTOPILOT_KEY}`;
  const enabled = row?.value?.enabled !== false;
  cache = { at: Date.now(), enabled };
  return enabled;
}

/** The switch as the runs page shows it, and how many sources a round would fetch now. */
export async function collectionOverview(): Promise<{ auto: boolean; registered: boolean; due: number; updatedAt: Date | null; updatedBy: string | null }> {
  const [[row], [due], [registered]] = await Promise.all([
    sql<{ value: { enabled?: boolean }; updated_at: Date; updated_by: string | null }[]>`
      SELECT value, updated_at, updated_by FROM settings WHERE key = ${AUTOPILOT_KEY}`,
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sources
      WHERE enabled AND kind IN ('rss', 'web_list', 'json_list', 'x_search') AND (next_fetch_at IS NULL OR next_fetch_at <= now())`,
    // The worker registers cron.sources.schedule only with COLLECT_ENABLED, and drops it when it does not.
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.schedule WHERE name = 'cron.sources.schedule'`,
  ]);
  return {
    auto: row?.value?.enabled !== false,
    registered: Number(registered?.n ?? 0) > 0,
    due: Number(due?.n ?? 0),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

/** Pauses or resumes the collection schedules. Every change is audited. */
export async function setAutoCollect(enabled: boolean, reason: string, actor: string) {
  if (!reason?.trim()) throw new Error("reason is required");
  const before = await autoCollectEnabled();
  invalidateAutopilot();
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${AUTOPILOT_KEY}, ${sql.json({ enabled })}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, enabled ? "collection.autopilot.on" : "collection.autopilot.off", `settings:${AUTOPILOT_KEY}`, reason,
    { enabled: before }, { enabled });
  return { enabled, before };
}

/**
 * One round now: every source whose next_fetch_at has come, whatever the switch says. Paid listings
 * (Jina, X) are billed like a scheduled run, and the round is audited like any other manual fetch.
 * Returns how many fetch jobs were created; nothing is fetched here, the worker does that.
 */
export async function collectRoundNow(reason: string, actor: string) {
  const result = await scheduleDueSources();
  await audit(actor, "collection.round", `settings:${AUTOPILOT_KEY}`, reason.trim() || null, null, result);
  return result;
}
