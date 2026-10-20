// 行情：黄金现货与指数基金的日线。FRED 不给基金价格，公开的 Yahoo/Stooq 又挡着，
// 所以这一块走第三方的行情 API——配了哪个用哪个，一个都没配就整块不采集。
// 免费额度都够一个站自用：Twelve Data 每分钟 8 次，Polygon 每分钟 5 次，Alpha Vantage 每天 25 次。
import { credential } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { Point } from "../logic.ts";

export type MarketProvider = "twelvedata" | "polygon" | "alphavantage";

/** 配了哪几家，按这个顺序用：前面那家取不到就换下一家。 */
export function marketProviders(): MarketProvider[] {
  const list: MarketProvider[] = [];
  if (credential("collectors", "TWELVE_DATA_API_KEY")) list.push("twelvedata");
  if (credential("collectors", "POLYGON_API_KEY")) list.push("polygon");
  if (credential("collectors", "ALPHA_VANTAGE_API_KEY")) list.push("alphavantage");
  return list;
}

/** 首选那一家，用来回答"有没有配行情接口"。 */
export function marketProvider(): MarketProvider | null {
  return marketProviders()[0] ?? null;
}

async function fromTwelveData(symbol: string, key: string, since: string): Promise<Point[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol === "XAUUSD" ? "XAU/USD" : symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "5000");
  url.searchParams.set("start_date", since);
  url.searchParams.set("apikey", key);
  const res = await guardedFetch(url.href, { timeoutMs: 25_000, maxBytes: 8 * 1024 * 1024 });
  if (res.status !== 200) throw new Error(`Twelve Data ${symbol}：HTTP ${res.status}`);
  const json = JSON.parse(await res.text()) as { status?: string; message?: string; values?: { datetime: string; close: string }[] };
  if (json.status === "error" || !json.values) throw new Error(`Twelve Data ${symbol}：${json.message ?? "没有返回数据"}`);
  return json.values
    .map((v) => ({ at: v.datetime.slice(0, 10), value: Number(v.close) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

async function fromPolygon(symbol: string, key: string, since: string): Promise<Point[]> {
  const mapped = symbol === "XAUUSD" ? "C:XAUUSD" : symbol;
  const url = new URL(`https://api.polygon.io/v2/aggs/ticker/${mapped}/range/1/day/${since}/${new Date().toISOString().slice(0, 10)}`);
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "50000");
  url.searchParams.set("apiKey", key);
  const res = await guardedFetch(url.href, { timeoutMs: 25_000, maxBytes: 8 * 1024 * 1024 });
  if (res.status !== 200) throw new Error(`Polygon ${symbol}：HTTP ${res.status}`);
  const json = JSON.parse(await res.text()) as { results?: { t: number; c: number }[] };
  return (json.results ?? [])
    .map((r) => ({ at: new Date(r.t).toISOString().slice(0, 10), value: r.c }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);
}

async function fromAlphaVantage(symbol: string, key: string): Promise<Point[]> {
  // 实测：Alpha Vantage 的 FX_DAILY 和 CURRENCY_EXCHANGE_RATE 都不收贵金属代码 XAU。
  if (symbol === "XAUUSD") throw new Error("Alpha Vantage 的外汇接口不收贵金属代码 XAU");
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  // 免费 key 拿不到 full，只有最近 100 个交易日。做备用够用：历史是各家分别 upsert 的，
  // 用了它不会把 Twelve Data 攒下的历史抹掉。
  url.searchParams.set("outputsize", "compact");
  url.searchParams.set("apikey", key);
  const res = await guardedFetch(url.href, { timeoutMs: 25_000, maxBytes: 8 * 1024 * 1024 });
  if (res.status !== 200) throw new Error(`Alpha Vantage ${symbol}：HTTP ${res.status}`);
  const json = JSON.parse(await res.text()) as { "Time Series (Daily)"?: Record<string, { "4. close": string }>; Note?: string; Information?: string };
  if (json.Note ?? json.Information) throw new Error(`Alpha Vantage ${symbol}：${json.Note ?? json.Information}`);
  const series = json["Time Series (Daily)"] ?? {};
  return Object.entries(series)
    .map(([at, v]) => ({ at: at.slice(0, 10), value: Number(v["4. close"]) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

const KEY_ENV: Record<MarketProvider, string> = {
  twelvedata: "TWELVE_DATA_API_KEY",
  polygon: "POLYGON_API_KEY",
  alphavantage: "ALPHA_VANTAGE_API_KEY",
};

async function fetchWith(provider: MarketProvider, symbol: string, since: string): Promise<Point[]> {
  const key = credential("collectors", KEY_ENV[provider]);
  if (!key) throw new Error(`${KEY_ENV[provider]} 未配置`);
  if (provider === "twelvedata") return fromTwelveData(symbol, key, since);
  if (provider === "polygon") return fromPolygon(symbol, key, since);
  return fromAlphaVantage(symbol, key);
}

/**
 * 取一个符号的日线。配了几家就按顺序试：额度用尽、临时故障、这家根本不收这个代码，
 * 都换下一家。全试过还不行就把每家的原因一起抛出来，采集记录里能看明白。
 */
export async function fetchMarket(symbol: string, since: string): Promise<Point[]> {
  const providers = marketProviders();
  if (!providers.length) throw new Error("没有配置行情 API key");
  const reasons: string[] = [];
  for (const provider of providers) {
    try {
      return await fetchWith(provider, symbol, since);
    } catch (error) {
      reasons.push(`${provider}：${(error as Error).message.slice(0, 100)}`);
    }
  }
  throw new Error(`${symbol} 这几家都取不到（${reasons.join("；")}）`);
}
