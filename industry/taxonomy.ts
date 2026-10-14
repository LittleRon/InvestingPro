// 这个行业的分类体系：类别、标签词表、主体机构名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（观点、策略）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "macro", label: "宏观", feedLabel: "宏观数据", section: "宏观与政策", guide: "货币政策与利率决议（美联储、欧央行等）、通胀（CPI/PPI）、就业（非农）、GDP、零售销售等宏观数据的发布，以及央行官员对政策路径的公开表述。只记录“这次发布、这次表述”本身；对数据的解读归观点，据数据写的市场评论归市场。" },
  { key: "policy", label: "政策", feedLabel: "政策监管", section: "宏观与政策", guide: "监管法规、贸易与产业政策、财税安排、执法处罚与合规要求（SEC、证监会、欧盟等）。已生效或正式公布的才算；征求意见稿与草案可收，但须写明所处阶段。" },
  { key: "markets", label: "市场", feedLabel: "市场行情", section: "市场动态", guide: "股指、债市、汇市、大宗商品与加密资产的行情、异动与结构变化，以及市场制度调整（交易规则、指数编成、休市安排）。只收有具体数字或具体规则变化的；泛泛的“市场情绪乐观”归观点。" },
  { key: "earnings", label: "财报", feedLabel: "财报业绩", section: "公司与财报", guide: "上市公司定期财报、业绩预告与指引、分红回购与股权激励。券商对评级和目标价的调整归研究。" },
  { key: "deals", label: "公司", feedLabel: "公司事件", section: "公司与财报", guide: "融资、并购、IPO 与上市、重组、破产、重大合同、管理层与股权变动、公司官方公告（8-K 等）中的重大事件。只有传闻、未经确认的不按已发生收。" },
  { key: "funds", label: "资金", feedLabel: "资金流向", section: "资金与机构", guide: "ETF 与共同基金申赎流向、机构持仓变化（13F、托管数据）、跨境资金流动、主权与长线机构的公开动作。只收有数据披露的。" },
  { key: "research", label: "研究", feedLabel: "研究报告", section: "研究与观点", guide: "券商研报、机构白皮书、官方或第三方数据研究，其中有新数据、新方法或新结论的。只是转述别家观点、没有自己方法与数据的归观点。" },
  { key: "opinion", label: "观点", section: "研究与观点", guide: "机构策略观点、名家评论、多空研判、访谈观点。重点是作者的解释、判断、主张或预测；讨论市场不自动归观点，作者是名人不自动归观点。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（投资行业是宏观数据）：日报报头的“N 项宏观数据”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "macro", tag: "宏观数据", unit: "项宏观数据" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = [
  "fed", "fomc", "sec", "ecb", "boe", "boj", "eia", "cpi", "ppi", "pce", "gdp", "etf", "ipo", "spx", "eps", "pe", "pb", "roe", "bps",
  "yoy", "mom", "qoq", "ism", "pmi", "adp", "opec", "imf", "wto", "qe", "qt", "ath", "lpr", "mlf",
];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["macro_release", "market_move", "earnings_report", "corporate_action", "policy_regulation", "research_report", "fund_flow", "opinion_strategy"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "宏观数据", "央行政策", "市场行情", "财报业绩", "公司事件", "政策监管", "研究报告", "资金流向", "机构观点",
  "其他",
] as const;

/** 可选的主题标签：资产类别、市场与行业。 */
export const TOPIC_TAGS = [
  "股票", "债券", "外汇", "黄金", "原油", "工业金属", "农产品", "加密资产", "房地产",
  "A股", "美股", "港股", "欧股", "日股", "新兴市场",
  "科技", "金融", "能源", "医药", "消费", "制造", "军工", "交运",
] as const;

/** 可选的实体标签（央行、监管机构、机构与公司）。 */
export const ENTITY_TAGS = ["美联储", "欧央行", "英国央行", "日本央行", "中国人民银行", "SEC", "IMF", "EIA", "高盛", "摩根大通", "贝莱德", "伯克希尔", "苹果", "英伟达", "微软", "特斯拉", "谷歌", "亚马逊", "Meta", "台积电"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  // 分类标签近义词
  加息: "央行政策", 降息: "央行政策", 利率: "央行政策", 利率决议: "央行政策", 缩表: "央行政策", 扩表: "央行政策", 点阵图: "央行政策", 央行: "央行政策",
  通胀: "宏观数据", 物价: "宏观数据", 非农: "宏观数据", 就业: "宏观数据", 失业率: "宏观数据", 零售销售: "宏观数据", 经济数据: "宏观数据", 数据: "宏观数据",
  大盘: "市场行情", 股指: "市场行情", 涨跌: "市场行情", 异动: "市场行情", 新高: "市场行情", 新低: "市场行情", 行情: "市场行情", 收盘: "市场行情", 开盘: "市场行情",
  财报: "财报业绩", 业绩: "财报业绩", 营收: "财报业绩", 利润: "财报业绩", 指引: "财报业绩", 分红: "财报业绩", 回购: "财报业绩", 减持: "财报业绩", 增持: "财报业绩", 股权激励: "财报业绩",
  融资: "公司事件", 并购: "公司事件", 收购: "公司事件", ipo: "公司事件", 上市: "公司事件", 重组: "公司事件", 破产: "公司事件", 退市: "公司事件", 合同: "公司事件", 人事: "公司事件",
  政策: "政策监管", 监管: "政策监管", 法规: "政策监管", 关税: "政策监管", 贸易: "政策监管", 制裁: "政策监管", 处罚: "政策监管", 立法: "政策监管",
  研报: "研究报告", 白皮书: "研究报告", 深度: "研究报告", 数据研究: "研究报告", 报告: "研究报告",
  etf: "资金流向", 基金: "资金流向", 持仓: "资金流向", 北向: "资金流向", 南向: "资金流向", 资金: "资金流向", 申赎: "资金流向", "13f": "资金流向",
  观点: "机构观点", 策略: "机构观点", 评论: "机构观点", 研判: "机构观点", 展望: "机构观点", 访谈: "机构观点", 多空: "机构观点",
  // 主题标签近义词
  股市: "股票", a股: "A股", 沪深: "A股", 创业板: "A股", 科创板: "A股",
  美股: "美股", 纳斯达克: "美股", 标普: "美股", 道琼斯: "美股", 华尔街: "美股",
  港股: "港股", 恒生: "港股", 中概股: "港股",
  债券: "债券", 美债: "债券", 收益率: "债券", 国债: "债券", 信用债: "债券",
  外汇: "外汇", 汇率: "外汇", 美元: "外汇", 人民币: "外汇", 日元: "外汇", 欧元: "外汇",
  黄金: "黄金", 贵金属: "黄金", 白银: "黄金",
  原油: "原油", 石油: "原油", 油价: "原油",
  铜: "工业金属", 铝: "工业金属", 铁矿: "工业金属", 有色金属: "工业金属",
  加密: "加密资产", 比特币: "加密资产", btc: "加密资产", 以太坊: "加密资产", eth: "加密资产", 数字货币: "加密资产",
  房地产: "房地产", 楼市: "房地产", 房贷: "房地产", 地产: "房地产",
  科技: "科技", 半导体: "科技", 芯片: "科技", 互联网: "科技", 软件: "科技", 人工智能: "科技", ai: "科技",
  金融: "金融", 银行: "金融", 保险: "金融", 证券: "金融",
  能源: "能源", 电力: "能源", 新能源: "能源", 光伏: "能源", 风电: "能源",
  医药: "医药", 生物: "医药", 医疗: "医药", 创新药: "医药",
  消费: "消费", 零售: "消费", 白酒: "消费", 食品饮料: "消费", 家电: "消费",
  制造: "制造", 制造业: "制造", 机械: "制造", 汽车: "制造",
  军工: "军工", 国防: "军工",
  交运: "交运", 航空: "交运", 航运: "交运", 物流: "交运", 港口: "交运",
  // 实体标签近义词
  美联储: "美联储", fed: "美联储", fomc: "美联储", 联储: "美联储",
  欧央行: "欧央行", ecb: "欧央行", 欧洲央行: "欧央行",
  英国央行: "英国央行", boe: "英国央行", 英格兰银行: "英国央行",
  日本央行: "日本央行", boj: "日本央行",
  中国人民银行: "中国人民银行", pboc: "中国人民银行", 人民银行: "中国人民银行",
  sec: "SEC", 美国证监会: "SEC", 证交会: "SEC",
  imf: "IMF", 国际货币基金组织: "IMF",
  eia: "EIA", 能源信息署: "EIA",
  高盛: "高盛", goldman: "高盛", "goldman sachs": "高盛",
  摩根大通: "摩根大通", jpmorgan: "摩根大通", "jp morgan": "摩根大通",
  贝莱德: "贝莱德", blackrock: "贝莱德",
  伯克希尔: "伯克希尔", berkshire: "伯克希尔",
  苹果: "苹果", apple: "苹果",
  英伟达: "英伟达", nvidia: "英伟达",
  微软: "微软", microsoft: "微软",
  特斯拉: "特斯拉", tesla: "特斯拉",
  谷歌: "谷歌", google: "谷歌", alphabet: "谷歌",
  亚马逊: "亚马逊", amazon: "亚马逊", aws: "亚马逊",
  meta: "Meta", facebook: "Meta",
  台积电: "台积电", tsmc: "台积电",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 主体主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是机构自己的其他称呼（官方账号名、子品牌），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  fed: { name: "美联储 Federal Reserve", displayTag: "美联储", aliases: ["Federal Reserve", "Fed", "FOMC", "美联储", "联储"], otherNames: ["Federal Reserve Board", "Board of Governors"] },
  ecb: { name: "欧洲央行 ECB", displayTag: "欧央行", aliases: ["European Central Bank", "ECB", "欧央行", "欧洲央行"] },
  boe: { name: "英国央行 Bank of England", displayTag: "英国央行", aliases: ["Bank of England", "BoE", "英国央行", "英格兰银行"] },
  boj: { name: "日本央行 Bank of Japan", displayTag: "日本央行", aliases: ["Bank of Japan", "BoJ", "日本央行"] },
  pboc: { name: "中国人民银行 PBOC", displayTag: "中国人民银行", aliases: ["People's Bank of China", "PBOC", "中国人民银行", "人民银行", "央行"] },
  sec: { name: "美国证监会 SEC", displayTag: "SEC", aliases: ["Securities and Exchange Commission", "SEC", "美国证监会", "证交会"] },
  eia: { name: "美国能源信息署 EIA", displayTag: "EIA", aliases: ["Energy Information Administration", "EIA", "美国能源信息署", "能源信息署"] },
  apple: { name: "苹果 Apple", displayTag: "苹果", aliases: ["Apple", "苹果"], otherNames: ["Apple Newsroom"] },
  nvidia: { name: "英伟达 NVIDIA", displayTag: "英伟达", aliases: ["NVIDIA", "英伟达"] },
  microsoft: { name: "微软 Microsoft", displayTag: "微软", aliases: ["Microsoft", "微软"] },
  tesla: { name: "特斯拉 Tesla", displayTag: "特斯拉", aliases: ["Tesla", "特斯拉"] },
  alphabet: { name: "谷歌 Alphabet", displayTag: "谷歌", aliases: ["Alphabet", "Google", "谷歌"] },
  amazon: { name: "亚马逊 Amazon", displayTag: "亚马逊", aliases: ["Amazon", "亚马逊", "AWS"] },
  meta: { name: "Meta", displayTag: "Meta", aliases: ["Meta", "Facebook"] },
  jpmorgan: { name: "摩根大通 JPMorgan", displayTag: "摩根大通", aliases: ["JPMorgan", "JP Morgan", "摩根大通"] },
  berkshire: { name: "伯克希尔 Berkshire", displayTag: "伯克希尔", aliases: ["Berkshire Hathaway", "Berkshire", "伯克希尔"] },
};

/**
 * 身份词典：摘要和标题里出现的机构与公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "fed", name: "美联储", patterns: [/federal reserve|\bfed\b|\bfomc\b|美联储|联储/i] },
  { id: "ecb", name: "欧洲央行", patterns: [/european central bank|\becb\b|欧央行|欧洲央行/i] },
  { id: "boe", name: "英国央行", patterns: [/bank of england|\bboe\b|英国央行|英格兰银行/i] },
  { id: "boj", name: "日本央行", patterns: [/bank of japan|\bboj\b|日本央行/i] },
  { id: "pboc", name: "中国人民银行", patterns: [/people'?s bank of china|\bpboc\b|中国人民银行|人民银行/i] },
  { id: "sec", name: "美国证监会", patterns: [/securities and exchange commission|\bsec\b|美国证监会|证交会/i] },
  { id: "eia", name: "美国能源信息署", patterns: [/energy information administration|\beia\b|能源信息署/i] },
  { id: "apple", name: "苹果", patterns: [/\bapple\b|苹果/i] },
  { id: "nvidia", name: "英伟达", patterns: [/nvidia|英伟达/i] },
  { id: "microsoft", name: "微软", patterns: [/microsoft|微软/i] },
  { id: "tesla", name: "特斯拉", patterns: [/tesla|特斯拉/i] },
  { id: "alphabet", name: "谷歌", patterns: [/alphabet|\bgoogle\b|谷歌/i] },
  { id: "amazon", name: "亚马逊", patterns: [/amazon|亚马逊/i] },
  { id: "meta", name: "Meta", patterns: [/\bmeta\b/i] },
  { id: "jpmorgan", name: "摩根大通", patterns: [/jpmorgan|jp morgan|摩根大通/i] },
  { id: "berkshire", name: "伯克希尔", patterns: [/berkshire|伯克希尔/i] },
];

/** 这些域名上的文章，发布方就是对应的机构（托管平台如 SEC 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "fed", domains: ["federalreserve.gov"] },
  { entityId: "ecb", domains: ["ecb.europa.eu"] },
  { entityId: "boe", domains: ["bankofengland.co.uk"] },
  { entityId: "boj", domains: ["boj.or.jp"] },
  { entityId: "sec", domains: ["sec.gov"] },
  { entityId: "eia", domains: ["eia.gov"] },
  { entityId: "apple", domains: ["apple.com"] },
];

/**
 * 抓取正文时（页面由抓取器渲染成 Markdown），这些站点会在文章外面套上自己的导航与推荐流，
 * 夹在文章里的图注与说明要留下。按各自的边界裁：`pathPrefix` 是文章页的路径前缀，
 * `newsHref` 是推荐流那一节里“查看全部”的链接，引擎靠它认出边界。
 */
export const READER_CHROME: ReadonlyArray<{ host: string; pathPrefix: string; newsHref: string }> = [
  { host: "apple.com", pathPrefix: "/newsroom/", newsHref: "https://www.apple.com/newsroom/" },
];

/** 原文里的这些写法也算提到了对应机构。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
