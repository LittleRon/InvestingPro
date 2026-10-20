// 中证指数：上证综指（000001）与中证全债（H11001）的日线。免费，无需 key，要带 User-Agent。
// 一个是被观察的市场本身，一个是利率环境的代理。
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { httpError, withRetry } from "./retry.ts";
import type { Point } from "../logic.ts";

const BASE = "https://www.csindex.com.cn/csindex-home/perf/index-perf";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const CS_INDEXES = {
  shanghai: { code: "000001", name: "上证综指" },
  bond: { code: "H11001", name: "中证全债" },
} as const;

export type CsIndexKey = keyof typeof CS_INDEXES;

/** 一条指数的日线（收盘价）。tradeDate 是 YYYYMMDD。 */
export async function fetchCsIndex(key: CsIndexKey, sinceYear = 2005): Promise<Point[]> {
  const { code } = CS_INDEXES[key];
  const url = new URL(BASE);
  url.searchParams.set("indexCode", code);
  url.searchParams.set("startDate", `${sinceYear}0101`);
  url.searchParams.set("endDate", "20991231");
  const rows = await withRetry(3, async () => {
    const res = await guardedFetch(url.href, {
      timeoutMs: 40_000,
      maxBytes: 16 * 1024 * 1024,
      headers: { "user-agent": UA, referer: "https://www.csindex.com.cn/", accept: "application/json" },
    });
    if (res.status !== 200) throw httpError(`中证 ${code}`, res.status);
    const json = JSON.parse(await res.text()) as { data?: { tradeDate: string; close: number | null }[] };
    return json.data ?? [];
  });
  const points: Point[] = [];
  for (const row of rows) {
    if (!/^\d{8}$/.test(row.tradeDate) || !Number.isFinite(row.close ?? NaN)) continue;
    const at = `${row.tradeDate.slice(0, 4)}-${row.tradeDate.slice(4, 6)}-${row.tradeDate.slice(6, 8)}`;
    points.push({ at, value: row.close! });
  }
  return points.sort((a, b) => (a.at < b.at ? -1 : 1));
}
