<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
    <img src="docs/assets/banner-light.png" alt="InvestPro：每个行业，都可以有自己的 InvestPro。很多条信源流进中间的精选，再分给宏观、市场、公司与研究各个栏目" width="100%">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-176b75?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Node.js-24-176b75?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/PostgreSQL-17-176b75?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/Docker-Compose-176b75?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  <b>一个自己找消息、自己写日报的投资信息平台。</b><br>
  盯住央行、监管、交易所与上市公司的一手信源，用大模型筛选、归并、写成中文摘要，附信号置信度与行业趋势。
</p>

<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="#跑起来">跑起来</a> ·
  <a href="#它是怎么工作的">它是怎么工作的</a> ·
  <a href="#文档">文档</a>
</p>

<br>

## 这是什么

InvestPro 是一个投资行业的信息采集与分析平台。它从一批高置信度信源（央行、监管机构、交易所公告、上市公司披露、财经媒体与研究）里收资料，用大模型先筛一遍、再独立打两次分，挑出真正值得看的，写成中文标题和摘要；把不同来源说的同一件事聚成一个事件，按有多少人在说排出热点；计算出每个事件的**信号置信度**（来源分级、独立报道方、讨论佐证合成的 0–100 分）和每个板块的**行业趋势**（近 7 天与前 7 天的收录变化）；每天早上 07:30 出一份日报。

**免责声明**：本站是公开信息的聚合与整理，所有内容仅供参考，不构成投资建议。

## 信源

预置 36 个信源，全部经过可用性验证，分三级：

| 分级 | 信源 |
|---|---|
| T1 官方一手（23） | 美联储（新闻稿、讲话、执法命令、银行申请、FEDS Notes）、欧洲央行、英国央行、日本央行、SEC 新闻稿、EIA、纽约联储 Liberty Street Economics、Apple Newsroom、苹果/微软/英伟达/特斯拉/谷歌/亚马逊/Meta/摩根大通/伯克希尔的 SEC EDGAR 8-K 公告，以及**国家统计局数据发布**与**数据解读** |
| T1.5 官方媒体与专业机构（2） | **证券日报网**（证监会指定披露媒体）、**Oxford Economics** |
| T2 媒体与个人（11） | WSJ Markets、CNBC Economy/Finance、MarketWatch、Seeking Alpha Market Currents、OilPrice、Mining.com、Net Interest、The Overshoot，以及**钛媒体**、**199IT 数据资讯中心** |

中文信源（微信公众号、X 账号）可在后台“信源”页按需添加：公众号需要极致了（Dajiala）的 key，X 需要 SocialData 的 key。字段说明见 [信源](docs/sources.md)。

宏观仪表盘（`/dashboard`）要的是数据序列，不是文章，所以另走一组接口，不占上面的信源：

| 接口 | 用途 | 怎么拿 |
|---|---|---|
| [FRED](https://fred.stlouisfed.org/docs/api/) | 中美 CPI/PPI、布伦特与 WTI 日价、大宗商品月度价格、两国全要素生产率 | 免费注册，把 key 写进 `.env` 的 `FRED_API_KEY` |
| [世界银行](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589) | 两国实际 GDP、固定资本形成、工业增加值、研发投入强度、专利申请量 | 免费，无需 key |
| Twelve Data / Polygon / Alpha Vantage | 黄金现货与指数基金日线（FRED 不给基金价格） | 免费额度，可以都配上：按 Twelve Data → Polygon → Alpha Vantage 的顺序用，前一家取不到自动换下一家 |

指数基金这一块有个取不到的地方要说明：沪深两所场内的 ETF（510300、518880）在 Twelve Data 的免费计划里拿不到，要 Pro 才给。所以切换到中国时，看到的是**在美股上市、跟踪 A 股的那几只**——ASHR（沪深300）、FXI（中国大盘股）、KWEB（中国互联网），按美元计价。要场内 ETF 的真实价格，得换数据源或者升级计划。

康德拉季耶夫长波 50–60 年一轮，而公开的长序列本身也不过六七十年，样本两端没有足够的邻点。滤波器在两端只能用得到的一半窗口，所以**长波的末端是估计出来的**，图上一律按虚线画，新数据进来会修正——这是长波分析改不掉的限制，本站选择把它标出来而不是藏起来。中国一侧的公开长序列只有年度（1960 年起），长波位置尤其只能当参考；可以用 Maddison Project 的长序列（1820 年起）替换，它一年才更新一次，所以要静态导入，见 [改成你的行业](docs/customize.md)。

### 三周期能不能预测股市：实测结论

`scripts/cn-cycles.ts` 做过一轮滚动样本外检验（预测未来 5 个月的收益，收缩强度在训练窗内用时间顺序交叉验证挑，宏观数据按发布滞后对齐）：

- **最好的组合 R² 约 0.05，而且随起点在 −0.73 到 +0.08 之间摆动**——不稳健，不能拿去做预测；
- 方向命中率 66~67%，但样本里「永远猜涨」的基准就有 55%，真实信息量约 12 个百分点；
- 拐点命中率（±3 个月容差）最高 23%；
- 股市周期分量与实体经济周期（PPI 提的基钦）的相关是 **0.30**：能刻画位置，不足以预测收益。

所以站上做的是**位置 + 历史类比**：告诉你现在站在三个周期的什么位置，以及历史上经济在类似位置时、上证之后走过什么。不做外推，不预测点位。这一点写在页面上，也写在这里。

信源是分三级的关键：T1 门槛 60、T1.5 门槛 65、T2 门槛 76（两次评分之和 ≥ 2 × 门槛），所以分级直接决定一条消息能不能进精选。证监会、上交所、巨潮资讯、港交所这些官网只有动态加载的列表、没有可订阅的 feed，无法用 RSS/网页列表稳定抓取，因此没有预置；要用它们的数据，可以走后台的推送接口或公众号。

## 你会得到什么

| | |
|---|---|
| **六种信源** | RSS、网页列表、JSON 接口、X 账号、微信公众号，以及你自己脚本推送进来的内容。信源分三级，各级入选门槛不同；抓取频率按产出自动调整 |
| **精选** | 预筛，同一份评分标准独立打两次分，再按信源分级的门槛决定入选；同一条新闻只占一条。提示词和门槛全部公开、可以改 |
| **写作** | 中文标题、答案先行的摘要、关注理由；分类、标签和新闻事实单独抽取；不给投资建议是写进提示词的硬边界 |
| **聚簇** | 不同来源报道的同一件事聚成一个事件，后续进展挂在同一个事件下，事件页有综述 |
| **热点** | 按事件算热度：独立来源越多越靠前；和 6 小时前比，涨得快的标上升 |
| **信号置信度** | `/signals`：每个热点事件的可核查程度（来源强度 + 交叉印证 + 讨论佐证），附监测概览。衡量“消息有多可核查”，不预测涨跌 |
| **行业趋势** | `/trends`：各市场与行业近 7 天与前 7 天的收录变化，哪个板块在升温、哪个在降温，当前最热的相关事件是什么 |
| **宏观仪表盘** | `/dashboard`：经济周期（康德拉季耶夫长波、朱格拉中周期、基钦短周期，可单独看也可叠加）、黄金与指数基金、原油、CPI/PPI、大宗商品。可切换中国与美国、自定义时间范围。数据取自 FRED、世界银行、东方财富与中证指数，每天 06:30 采集 |
| **历史类比** | `/dashboard`（中国视图）：按 PPI 同比、制造业 PMI 与康波背景找出历史上最相似的几个月，展示那之后两年上证的走势。回顾性统计，不是预测 |
| **每日 PEST 分析** | `/dashboard/report`：每天 06:40 按政治、经济、社会、技术四个象限写一份当天的宏观记录，依据的数据快照一起展示。是事实记录与观察清单，不是投资建议 |
| **日报、周报、月报** | 每天 07:30 出日报（赶在 A 股开盘前），每周一 09:00 周报、每月 1 日 09:30 月报 |
| **主题与搜索** | 机构与公司、市场与行业、内容形态三类主题页；标题摘要搜索和全文相关搜索 |
| **阅读设置** | 深浅色外观、字体切换；收藏和阅读设置只保存在本机，可导出导入 |
| **给 Agent 用** | RSS、公开 API、MCP、Agent Markdown、`llms.txt` |
| **后台** | 信源管理与试抓、内容诊断与人工评分更正、精选评测、每一步单独换模型、付费请求上限、运行记录与告警 |

## 控制模型调用的频率与花费

每一条采集到的内容要经过：预筛 1 次、评分 2 次（独立两次）、结构抽取 1 次、摘要或内容理解 1 次——**约 5 次调用**；入选的还要全文翻译、归组、事件综述，**约 8–10 次**。所以账单不是由某个定时任务决定的，是「采集量 × 每条的调用次数」乘出来的。

**后台 → 设置 → 付费请求上限** 是控制它的地方：给每个服务设每分钟、每小时、每天的上限，三个窗口都要填；填 0 立即停用，按「撤掉」恢复不限。它是熔断不是排队——超过上限后请求暂停，按窗口重试。

两件容易掉进去的事：

- **没设过上限的服务在表格里也列着**，标成「未设上限 · 用一次算一次」——它在花钱但不受任何约束，设一个就行；
- **默认装上的 `llm` 上限很宽**（每分钟 300、每天 40000），等于没设。新站部署完建议先调小。

调用量真正由三个地方决定：

| 位置 | 作用 |
|---|---|
| 后台 → 设置 → 付费请求上限 | 直接熔断，改完立刻生效，不用重启 |
| 后台 → 信源 | 暂停信源或调长抓取间隔——这是乘法，信源少一半，调用少一半 |
| 后台 → 模型与评测 | 预筛与评分调用最勤（每条共 3 次），把这两步换成便宜模型最省 |

要立刻停下来：`.env` 里设 `MODEL_CALLS_ENABLED=false`（停所有模型调用）或 `COLLECT_ENABLED=false`（停采集）。这两个是环境变量，前端没有开关。

## 跑起来

需要 [Docker](https://docs.docker.com/get-started/get-docker/)、Node.js 24（运行 `init-env` 生成配置要用），和一个 OpenAI 兼容的模型 API Key（DeepSeek、千问、智谱都可以）。

```bash
git clone <你的仓库> investpro
cd investpro
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>。后台在 `/admin`，管理员密码在 `.env` 的 `ADMIN_PASSWORD` 里。一两分钟后开始有内容，第一次导入的资料大约半小时处理完。

3000 端口被别的应用占了，就在 `.env` 里加一行 `PORT=8080`（换成一个空闲端口），同时把 `SITE_URL` 改成 `http://localhost:8080`——生成的链接、RSS 和分享图都按它拼。只想让本机的反向代理访问时写 `PORT=127.0.0.1:8080`。改完 `docker compose up -d` 即可，不用重新构建镜像。

不用 Docker、在 Linux/macOS（Windows 用 WSL2）上直接跑、配域名和 HTTPS、服务器在中国大陆，见 [部署](docs/deploy.md)。

站点跑起来后，打开 `/agent` 可以复制 MCP、RSS 或 API 的接入方式。

## 把它改成你的行业

这个站是 [AIHOT 开源框架](https://github.com/KKKKhazix/AIHOT) 的一个行业实例：投资行业的分类、信源、提示词和门槛都在 `industry/` 和 `site/` 里，引擎代码在 `apps/` 和 `packages/`。要换成另一个行业，按 [docs/customize.md](docs/customize.md) 的步骤改这两个文件夹即可；投资专属的“信号置信度 / 行业趋势”是 `modules/invest-signals/` 模块，换成其他行业时可以删掉它、或照它写自己的模块。

最值得花时间的是评分标准（`industry/prompts/selection-score.md`）和门槛：拿一两百条你自己标注过的资料，用 `scripts/eval-selection.ts` 跑一遍，看它选得准不准，再回去改。当前门槛（T1 60 / T1_5 65 / T2 76）沿用框架默认值，偏严，正式上线前请按 [精选与校准](docs/selection.md) 重新校准。

## 文档

| 文档 | 内容 |
|---|---|
| [改成你的行业](docs/customize.md) | 站名、分类、主题、信源、提示词、门槛、模型、品牌，一步一步来 |
| [信源](docs/sources.md) | 六种信源怎么配，分级和全文，抓取频率，外部推送接口 |
| [精选与校准](docs/selection.md) | 一条资料怎么变成精选，怎么用自己的样本校准 |
| [事件归组与关系评测](docs/grouping.md) | 事件关系怎么判断，怎么用自己标注的成对样本评测 |
| [综述评测](docs/story-digest-evaluation.md) | 改事件综述提示词前，怎么并排比较 |
| [部署](docs/deploy.md) | Docker、域名和 HTTPS、中国大陆、更新、备份 |
| [架构](docs/architecture.md) | 三个进程、目录、模块、数据库迁移、对外出口、测试 |

技术栈：Node.js 24 · TypeScript · React Router（服务端渲染）· Fastify · PostgreSQL · pg-boss · Tailwind CSS · Docker Compose。

## 许可

代码使用 [MIT 许可证](LICENSE)。
