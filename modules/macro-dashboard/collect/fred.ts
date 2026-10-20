// FRED（圣路易斯联储）的序列观测值。免费，需要 key：在 fred.stlouisfed.org 注册后
// 写进 collectors 组的 FRED_API_KEY。缺 key 时这个来源整体跳过，不假装拿到数据。
import { credential } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { httpError, withRetry } from "./retry.ts";
import type { Point } from "../logic.ts";

export function fredConfigured(): boolean {
  return credential("collectors", "FRED_API_KEY") !== null;
}

/** 一条序列的观测值。`since` 之后才开始取（YYYY-MM-DD），省得每次都搬全部历史。 */
export async function fetchFred(series: string, since?: string): Promise<Point[]> {
  const key = credential("collectors", "FRED_API_KEY");
  if (!key) throw new Error("FRED_API_KEY 未配置");
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", series);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  if (since) url.searchParams.set("observation_start", since);
  const points = await withRetry(3, async () => {
    const res = await guardedFetch(url.href, { timeoutMs: 30_000, maxBytes: 16 * 1024 * 1024 });
    if (res.status !== 200) throw httpError(`FRED ${series}`, res.status);
    const json = JSON.parse(await res.text()) as { observations?: { date: string; value: string }[] };
    const parsed: Point[] = [];
    for (const o of json.observations ?? []) {
      // FRED 用 "." 表示这个时点没有值，那是真缺，不能当 0。
      if (!o.value || o.value === ".") continue;
      const value = Number(o.value);
      if (!Number.isFinite(value)) continue;
      parsed.push({ at: o.date.slice(0, 10), value });
    }
    return parsed;
  });
  return points;
}
