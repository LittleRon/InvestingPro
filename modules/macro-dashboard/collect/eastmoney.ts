// 东方财富数据中心：中国的月度宏观数据（PPI、CPI、PMI、货币供应、GDP）。免费，无需 key，
// 但要求带 User-Agent 和 referer，否则不给。返回的 REPORT_DATE 是自然月的第一天。
// 这几个指标比 FRED 里能拿到的中国序列新得多（FRED 的中国 PPI 只到 2022 年）。
//
// 货币供应那张表的字段名不直观，按量级核对过（2026-09，单位亿元）：
//   FREE_CASH      =  15.0 万亿 = M0（流通中现金）
//   CURRENCY       = 116.8 万亿 = M1（狭义货币）
//   BASIC_CURRENCY = 359.6 万亿 = M2（广义货币）
// 早先把 CURRENCY 当成 M0、BASIC_CURRENCY 当成基础货币，两条线都标错了。
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { httpError, withRetry } from "./retry.ts";
import type { Point } from "../logic.ts";

const BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const EAST_MONEY_REPORTS = {
  ppi: { report: "RPT_ECONOMY_PPI", field: "BASE_SAME", indicatorId: undefined },
  cpi: { report: "RPT_ECONOMY_CPI", field: "NATIONAL_SAME", indicatorId: undefined },
  pmi: { report: "RPT_ECONOMY_PMI", field: "MAKE_INDEX", indicatorId: undefined },
  pmiNonMfg: { report: "RPT_ECONOMY_PMI", field: "NMAKE_INDEX", indicatorId: undefined },
  m0: { report: "RPT_ECONOMY_CURRENCY_SUPPLY", field: "FREE_CASH_SAME", indicatorId: undefined },
  m1: { report: "RPT_ECONOMY_CURRENCY_SUPPLY", field: "CURRENCY_SAME", indicatorId: undefined },
  m2: { report: "RPT_ECONOMY_CURRENCY_SUPPLY", field: "BASIC_CURRENCY_SAME", indicatorId: undefined },
  gdp: { report: "RPT_ECONOMY_GDP", field: "SUM_SAME", indicatorId: undefined },
  housing: { report: "RPT_INDUSTRY_INDEX", field: "INDICATOR_VALUE", indicatorId: "EMM00121987" },
  fiscal_revenue: { report: "RPT_ECONOMY_INCOME", field: "BASE_SAME", indicatorId: undefined },
} as const;

export type EastMoneyKey = keyof typeof EAST_MONEY_REPORTS;

/**
 * 一个报表的月度序列。报表里的值是当月同比（PPI/CPI/M0）或指数（PMI/国房景气），
 * 直接用，不再自己算同比。housing（国房景气指数）走 RPT_INDUSTRY_INDEX，
 * 按 INDICATOR_ID 过滤，数据有重复行（每月两条），去重后返回。
 */
export async function fetchEastMoney(key: EastMoneyKey): Promise<Point[]> {
  const { report, field, indicatorId } = EAST_MONEY_REPORTS[key];
  const url = new URL(BASE);
  url.searchParams.set("reportName", report);
  url.searchParams.set("columns", "ALL");
  url.searchParams.set("pageSize", "500");
  url.searchParams.set("sortColumns", "REPORT_DATE");
  url.searchParams.set("sortTypes", "1");
  if (indicatorId) {
    url.searchParams.set("filter", `(INDICATOR_ID="${indicatorId}")`);
    url.searchParams.set("source", "WEB");
    url.searchParams.set("client", "WEB");
  }
  const rows = await withRetry(3, async () => {
    const res = await guardedFetch(url.href, {
      timeoutMs: 30_000,
      maxBytes: 8 * 1024 * 1024,
      headers: { "user-agent": UA, referer: "https://data.eastmoney.com/", accept: "application/json" },
    });
    if (res.status !== 200) throw httpError(`东财 ${key}`, res.status);
    const json = JSON.parse(await res.text()) as { success?: boolean; result?: { data?: Record<string, unknown>[] } | null; message?: string };
    if (!json.result?.data?.length) throw new Error(`东财 ${key}：没有数据（${json.message ?? "空"}）`);
    return json.result.data;
  });
  const seen = new Set<string>();
  const points: Point[] = [];
  for (const row of rows) {
    const at = String(row.REPORT_DATE ?? "").slice(0, 10);
    const value = Number(row[field]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || !Number.isFinite(value)) continue;
    if (seen.has(at)) continue; // 东财 RPT_INDUSTRY_INDEX 每月有两条重复记录
    seen.add(at);
    points.push({ at, value });
  }
  return points.sort((a, b) => (a.at < b.at ? -1 : 1));
}
