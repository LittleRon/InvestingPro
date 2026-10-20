// 世界银行的开放 API（无需 key）拿年度序列：两国的实际 GDP、固定资本形成、工业增加值、
// 研发投入强度和专利申请量。它只有年度，所以用来给长波打底和做技术那侧的印证。
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { httpError, withRetry } from "./retry.ts";
import type { Point } from "../logic.ts";

const BASE = "https://api.worldbank.org/v2/country";

/** `spec` 是 "ISO2:指标ID"，比如 "CN:NY.GDP.MKTP.KD"。 */
export async function fetchWorldBank(spec: string, since?: number): Promise<Point[]> {
  const [iso2, indicator] = spec.split(":");
  if (!iso2 || !indicator) throw new Error(`世行指标写法不对：${spec}`);
  const url = new URL(`${BASE}/${iso2.toLowerCase()}/indicator/${indicator}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("per_page", "300");
  url.searchParams.set("date", `${since ?? 1960}:${new Date().getUTCFullYear()}`);
  // 世行的接口常有一下很慢的时候，给它 45 秒，不行再试。
  const rows = await withRetry(3, async () => {
    const res = await guardedFetch(url.href, { timeoutMs: 45_000, maxBytes: 8 * 1024 * 1024 });
    if (res.status !== 200) throw httpError(`世行 ${spec}`, res.status);
    const json = JSON.parse(await res.text()) as [unknown, { value: number | null; date: string }[] | null] | { message?: unknown };
    return Array.isArray(json) ? json[1] : null;
  });
  const points: Point[] = [];
  for (const row of rows ?? []) {
    if (row.value === null || !Number.isFinite(row.value)) continue;
    // 年度的观测值戳在年末。
    points.push({ at: `${row.date}-12-31`, value: row.value });
  }
  return points.sort((a, b) => (a.at < b.at ? -1 : 1));
}
