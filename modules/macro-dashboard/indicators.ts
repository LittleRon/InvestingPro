// 仪表盘收哪些指标。这份清单就是整个模块的数据骨架：加一个指标只在这里加一行，
// 采集、接口、页面和报告的取数都从这里读。
//
// 每个指标都必须能在两个来源之一查到：FRED（series/observations，免费，需 key）或
// 世界银行（api.worldbank.org，免费，无需 key，只有年度）。行情类（黄金、ETF）走
// 单独的行情通道，没有配置 key 时那一块不采集、页面上说明原因，不伪造数据。
// `derived` 不是外部来源：它由本地已入库的两条序列相减得到（见 DERIVED_SERIES）。
export type BlockKey = "cycles" | "money" | "gold" | "oil" | "prices" | "commodities";
export type CountryKey = "CN" | "US";
export type Frequency = "D" | "W" | "M" | "Q" | "A";
export type SourceKey = "fred" | "worldbank" | "market" | "eastmoney" | "csindex" | "derived" | "composite";
/** 这条序列参与哪个周期的滤波；印证类（TFP、专利、研发）不参与。 */
export type CycleKey = "kondratiev" | "juglar" | "kitchin";

export interface Indicator {
  key: string;
  block: BlockKey;
  /** 中国的指标只在中国的视图里出现，美国的在美国视图里；大宗与原油是全球的，两边都显示。 */
  country: CountryKey | "GLOBAL";
  name: string;
  unit: string;
  frequency: Frequency;
  source: SourceKey;
  /** FRED 的 series id；世界银行写成 "ISO2:指标ID"；行情是逻辑符号（如 SPY、XAUUSD）。 */
  series: string;
  /** 参与周期滤波的频带。 */
  cycle?: CycleKey;
  /** 指数类在画图前先算同比；价格类（油价、金价）直接用原值。 */
  yoy?: boolean;
}

export const BLOCKS: ReadonlyArray<{ key: BlockKey; name: string; hint: string }> = [
  { key: "cycles", name: "经济周期", hint: "康德拉季耶夫长波、朱格拉中周期、基钦短周期，可单独看也可叠加" },
  { key: "money", name: "货币与剪刀差", hint: "中国 M0、M1、M2 同比，以及 M1−M2 剪刀差（月度，央行口径）" },
  { key: "gold", name: "市场与基金", hint: "黄金现货、主要指数基金，以及上证综指与中证全债" },
  { key: "oil", name: "原油", hint: "布伦特与 WTI 的现货价格" },
  { key: "prices", name: "CPI / PPI", hint: "消费者与生产者的价格水平，按同比，以及 PPI−CPI 剪刀差" },
  { key: "commodities", name: "大宗商品", hint: "世界银行 Pink Sheet 的月度全球价格" },
];

/**
 * 派生序列：本地用已入库的两条序列逐月相减，不新增外部数据源。
 * 两条的口径必须一致（这里都是同比百分数），差值的单位是百分点。
 */
export const DERIVED_SERIES = {
  /** M1 同比减 M2 同比：负得越多，资金越少地从定期转向活期。 */
  m1_m2_gap: { left: "cn.m1", right: "cn.m2" },
  /** PPI 同比减 CPI 同比：上游涨价能否传到下游。 */
  ppi_cpi_gap: { left: "cn.ppi", right: "cn.cpi" },
} as const;

export type DerivedKey = keyof typeof DERIVED_SERIES;

/**
 * 合成序列：几条量纲不同的月度指标各自标准化后加权平均（算法在 logic.ts 的 blendOf）。
 * 中国一侧没有足够长的月度实体经济序列（工业增加值、社融的公开接口拿不到），
 * 用景气、价格、货币三条合成一条，是能按月观察位置的最长的一条。
 * 权重是等权的：不做主观的行业判断，页面上把配方写出来，读者可以自己核。
 */
export const COMPOSITE_SERIES = {
  cn_cli: {
    parts: [
      { key: "cn.pmi", weight: 1 },
      { key: "cn.ppi", weight: 1 },
      { key: "cn.m1", weight: 1 },
    ],
  },
} as const;

export type CompositeKey = keyof typeof COMPOSITE_SERIES;

export const CYCLES: ReadonlyArray<{ key: CycleKey; name: string; short: string; lowYears: number; highYears: number }> = [
  { key: "kondratiev", name: "康德拉季耶夫长波", short: "长波", lowYears: 50, highYears: 60 },
  { key: "juglar", name: "朱格拉中周期", short: "中周期", lowYears: 7, highYears: 11 },
  { key: "kitchin", name: "基钦短周期", short: "短周期", lowYears: 3, highYears: 5 },
];

export const INDICATORS: readonly Indicator[] = [
  // ===== 经济周期 =====
  // 长波看实际 GDP：序列越长，长波位置越可信。下面两条是康波的底子。
  { key: "us.gdp", block: "cycles", country: "US", name: "美国 实际 GDP", unit: "十亿美元（2017 年价）", frequency: "Q", source: "fred", series: "GDPC1", cycle: "kondratiev" },
  { key: "cn.gdp", block: "cycles", country: "CN", name: "中国 实际 GDP", unit: "不变价美元", frequency: "A", source: "worldbank", series: "CN:NY.GDP.MKTP.KD", cycle: "kondratiev" },
  // 中周期看固定资本形成：设备与厂房的那一轮。
  { key: "us.fai", block: "cycles", country: "US", name: "美国 私人固定投资", unit: "十亿美元（2017 年价）", frequency: "Q", source: "fred", series: "GPDIC1", cycle: "juglar" },
  // 世行里中国固定资本形成的不变价序列只有一年（2015），用不了；这条是现价美元，
  // 1960 年起整段都有。中周期看的是投资那一段起伏，口径不一致写在页面上而不是藏起来。
  { key: "cn.fai", block: "cycles", country: "CN", name: "中国 固定资本形成", unit: "现价美元", frequency: "A", source: "worldbank", series: "CN:NE.GDI.FTOT.CD", cycle: "juglar" },
  // 短周期看工业产出与库存：三到五年的那一轮。
  { key: "us.ind", block: "cycles", country: "US", name: "美国 工业产出指数", unit: "指数 2017=100", frequency: "M", source: "fred", series: "INDPRO", cycle: "kitchin" },
  { key: "cn.ind", block: "cycles", country: "CN", name: "中国 工业增加值", unit: "不变价美元", frequency: "A", source: "worldbank", series: "CN:NV.IND.TOTL.KD", cycle: "kitchin" },
  // 印证：长波位置站不站得住，看技术那一侧的三条。
  { key: "us.tfp", block: "cycles", country: "US", name: "美国 全要素生产率", unit: "指数 2021=1", frequency: "A", source: "fred", series: "RTFPNAUSA632NRUG" },
  { key: "cn.tfp", block: "cycles", country: "CN", name: "中国 全要素生产率", unit: "指数 2021=1", frequency: "A", source: "fred", series: "RTFPNACNA632NRUG" },
  { key: "us.rd", block: "cycles", country: "US", name: "美国 研发投入强度", unit: "占 GDP %", frequency: "A", source: "worldbank", series: "US:GB.XPD.RSDV.GD.ZS" },
  { key: "cn.rd", block: "cycles", country: "CN", name: "中国 研发投入强度", unit: "占 GDP %", frequency: "A", source: "worldbank", series: "CN:GB.XPD.RSDV.GD.ZS" },
  { key: "us.patent", block: "cycles", country: "US", name: "美国 居民专利申请", unit: "件", frequency: "A", source: "worldbank", series: "US:IP.PAT.RESD" },
  { key: "cn.patent", block: "cycles", country: "CN", name: "中国 居民专利申请", unit: "件", frequency: "A", source: "worldbank", series: "CN:IP.PAT.RESD" },
  // 景气与产出，不参与滤波，只当印证读数（PMI 每月一期，GDP 每季一期）。这两条是月度的，
  // 比上面那些年度序列新得多——中国一侧真正能按月观察的位置主要看它们。
  { key: "cn.pmi", block: "cycles", country: "CN", name: "中国 制造业 PMI", unit: "指数", frequency: "M", source: "eastmoney", series: "pmi" },
  { key: "cn.pmi_nonmfg", block: "cycles", country: "CN", name: "中国 非制造业 PMI", unit: "指数", frequency: "M", source: "eastmoney", series: "pmiNonMfg" },
  // key 不能叫 cn.gdp：那是上面世界银行的年度实际 GDP，康波滤波的基序列。
  { key: "cn.gdp_yoy", block: "cycles", country: "CN", name: "中国 GDP 当季同比", unit: "同比 %", frequency: "Q", source: "eastmoney", series: "gdp" },

  // ===== 黄金与指数基金 =====
  { key: "gold.spot", block: "gold", country: "GLOBAL", name: "黄金现货 XAU/USD", unit: "美元/盎司", frequency: "D", source: "market", series: "XAUUSD" },
  // 中证给的日线：一个是市场本身，一个是利率环境的代理。两者都是历史类比要看的落地对象。
  { key: "cn.shanghai", block: "gold", country: "CN", name: "上证综指", unit: "点", frequency: "D", source: "csindex", series: "shanghai" },
  { key: "cn.bond", block: "gold", country: "CN", name: "中证全债", unit: "点", frequency: "D", source: "csindex", series: "bond" },
  { key: "us.etf.spy", block: "gold", country: "US", name: "SPY 标普500 ETF", unit: "美元", frequency: "D", source: "market", series: "SPY" },
  { key: "us.etf.qqq", block: "gold", country: "US", name: "QQQ 纳斯达克100 ETF", unit: "美元", frequency: "D", source: "market", series: "QQQ" },
  { key: "us.etf.gld", block: "gold", country: "US", name: "GLD 黄金 ETF", unit: "美元", frequency: "D", source: "market", series: "GLD" },
  { key: "us.etf.uso", block: "gold", country: "US", name: "USO 原油 ETF", unit: "美元", frequency: "D", source: "market", series: "USO" },
  { key: "us.etf.tlt", block: "gold", country: "US", name: "TLT 20年期美债 ETF", unit: "美元", frequency: "D", source: "market", series: "TLT" },
  // 沪深两所场内的 ETF（510300、518880）在 Twelve Data 的免费计划里取不到，要 Pro 才给。
  // 所以中国一侧用在美股上市、同样跟踪 A 股的那几只：ASHR 跟踪沪深300，FXI 是港股中国大盘股，
  // KWEB 是在美上市的中国互联网。它们按美元计价，页面上写清楚。
  { key: "cn.etf.ashr", block: "gold", country: "CN", name: "ASHR 沪深300 ETF", unit: "美元", frequency: "D", source: "market", series: "ASHR" },
  { key: "cn.etf.fxi", block: "gold", country: "CN", name: "FXI 中国大盘股 ETF", unit: "美元", frequency: "D", source: "market", series: "FXI" },
  { key: "cn.etf.kweb", block: "gold", country: "CN", name: "KWEB 中国互联网 ETF", unit: "美元", frequency: "D", source: "market", series: "KWEB" },

  // ===== 原油 =====
  { key: "oil.brent", block: "oil", country: "GLOBAL", name: "布伦特原油", unit: "美元/桶", frequency: "D", source: "fred", series: "DCOILBRENTEU" },
  { key: "oil.wti", block: "oil", country: "GLOBAL", name: "WTI 原油", unit: "美元/桶", frequency: "D", source: "fred", series: "DCOILWTICO" },

  // ===== CPI / PPI =====
  { key: "us.cpi", block: "prices", country: "US", name: "美国 CPI", unit: "同比 %", frequency: "M", source: "fred", series: "CPIAUCSL", yoy: true },
  { key: "us.core_cpi", block: "prices", country: "US", name: "美国 核心 CPI", unit: "同比 %", frequency: "M", source: "fred", series: "CPILFESL", yoy: true },
  { key: "us.ppi", block: "prices", country: "US", name: "美国 PPI", unit: "同比 %", frequency: "M", source: "fred", series: "PPIACO", yoy: true },
  // 中国的 CPI、PPI 改走东方财富：它给的是当月同比，能到上个月；FRED 里的中国 PPI 只到 2022 年，
  // 中国 CPI 也停在 2025 年初，都不够用。这两个值本身就是同比，不再自己算一次。
  { key: "cn.cpi", block: "prices", country: "CN", name: "中国 CPI", unit: "同比 %", frequency: "M", source: "eastmoney", series: "cpi" },
  { key: "cn.ppi", block: "prices", country: "CN", name: "中国 PPI", unit: "同比 %", frequency: "M", source: "eastmoney", series: "ppi" },
  { key: "cn.ppi_cpi_gap", block: "prices", country: "CN", name: "PPI−CPI 剪刀差", unit: "百分点", frequency: "M", source: "derived", series: "ppi_cpi_gap" },

  // ===== 货币与剪刀差（中国，月度，央行口径经东方财富转发）=====
  // 三个层次分别是流通中现金、狭义货币、广义货币，页面上按同比给出。
  { key: "cn.m0", block: "money", country: "CN", name: "中国 M0 同比", unit: "同比 %", frequency: "M", source: "eastmoney", series: "m0" },
  { key: "cn.m1", block: "money", country: "CN", name: "中国 M1 同比", unit: "同比 %", frequency: "M", source: "eastmoney", series: "m1" },
  { key: "cn.m2", block: "money", country: "CN", name: "中国 M2 同比", unit: "同比 %", frequency: "M", source: "eastmoney", series: "m2" },
  { key: "cn.m1_m2_gap", block: "money", country: "CN", name: "M1−M2 剪刀差", unit: "百分点", frequency: "M", source: "derived", series: "m1_m2_gap" },
  // 中国景气合成：PMI、PPI、M1 三条月度等权标准化合成。它是中国一侧唯一够长、够密，
  // 能拿去分离中周期与短周期的序列（单看任何一条都只反映一个侧面）。
  { key: "cn.cli", block: "cycles", country: "CN", name: "中国景气合成（PMI·PPI·M1）", unit: "标准化", frequency: "M", source: "composite", series: "cn_cli" },

  // ===== 大宗商品（世界银行 Pink Sheet，月度）=====
  { key: "com.copper", block: "commodities", country: "GLOBAL", name: "铜", unit: "美元/吨", frequency: "M", source: "fred", series: "PCOPPUSDM" },
  { key: "com.aluminum", block: "commodities", country: "GLOBAL", name: "铝", unit: "美元/吨", frequency: "M", source: "fred", series: "PALUMUSDM" },
  { key: "com.iron", block: "commodities", country: "GLOBAL", name: "铁矿石", unit: "美元/吨", frequency: "M", source: "fred", series: "PIORECRUSDM" },
  { key: "com.coal", block: "commodities", country: "GLOBAL", name: "动力煤（澳洲）", unit: "美元/吨", frequency: "M", source: "fred", series: "PCOALAUUSDM" },
  { key: "com.energy", block: "commodities", country: "GLOBAL", name: "能源指数", unit: "指数 2016=100", frequency: "M", source: "fred", series: "PNRGINDEXM" },
  { key: "com.gas_eu", block: "commodities", country: "GLOBAL", name: "天然气（欧盟）", unit: "美元/百万英热", frequency: "M", source: "fred", series: "PNGASEUUSDM" },
  { key: "com.lng_asia", block: "commodities", country: "GLOBAL", name: "LNG（亚洲）", unit: "美元/百万英热", frequency: "M", source: "fred", series: "PNGASJPUSDM" },
  { key: "com.wheat", block: "commodities", country: "GLOBAL", name: "小麦", unit: "美元/吨", frequency: "M", source: "fred", series: "PWHEAMTUSDM" },
];

/** 某个图块的指标，按国家过滤（"GLOBAL" 的指标两个视图都显示）。 */
export function indicatorsOf(block: BlockKey, country: CountryKey): Indicator[] {
  return INDICATORS.filter((i) => i.block === block && (i.country === country || i.country === "GLOBAL"));
}

export function findIndicator(key: string): Indicator | undefined {
  return INDICATORS.find((i) => i.key === key);
}
