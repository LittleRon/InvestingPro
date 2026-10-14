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

预置 30 个信源，全部经过可用性验证，分三级：

| 分级 | 信源 |
|---|---|
| T1 官方一手（21） | 美联储（新闻稿、讲话、执法命令、银行申请、FEDS Notes）、欧洲央行、英国央行、日本央行、SEC 新闻稿、EIA、纽约联储 Liberty Street Economics、Apple Newsroom，以及苹果/微软/英伟达/特斯拉/谷歌/亚马逊/Meta/摩根大通/伯克希尔的 SEC EDGAR 8-K 公告 |
| T2 媒体与个人（9） | WSJ Markets、CNBC Economy/Finance、MarketWatch、Seeking Alpha Market Currents、OilPrice、Mining.com、Net Interest、The Overshoot |

中文信源（微信公众号、X 账号）可在后台“信源”页按需添加：公众号需要极致了（Dajiala）的 key，X 需要 SocialData 的 key。字段说明见 [信源](docs/sources.md)。

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
| **日报、周报、月报** | 每天 07:30 出日报（赶在 A 股开盘前），每周一 09:00 周报、每月 1 日 09:30 月报 |
| **主题与搜索** | 机构与公司、市场与行业、内容形态三类主题页；标题摘要搜索和全文相关搜索 |
| **阅读设置** | 深浅色外观、字体切换；收藏和阅读设置只保存在本机，可导出导入 |
| **给 Agent 用** | RSS、公开 API、MCP、Agent Markdown、`llms.txt` |
| **后台** | 信源管理与试抓、内容诊断与人工评分更正、精选评测、每一步单独换模型、预算熔断、运行记录与告警 |

## 跑起来

需要 [Docker](https://docs.docker.com/get-started/get-docker/)、Node.js 24（运行 `init-env` 生成配置要用），和一个 OpenAI 兼容的模型 API Key（DeepSeek、千问、智谱都可以）。

```bash
git clone <你的仓库> investpro
cd investpro
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>。后台在 `/admin`，管理员密码在 `.env` 的 `ADMIN_PASSWORD` 里。一两分钟后开始有内容，第一次导入的资料大约半小时处理完。

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
