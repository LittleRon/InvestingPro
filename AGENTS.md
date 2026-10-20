# 给 Agent 的说明

这是 InvestPro：一个投资行业的重要信息采集与分析平台，基于 AIHOT 开源引擎（`apps/`、`packages/` 是引擎，来自上游，尽量不改）。它从央行、监管、交易所与上市公司的一手信源采集资料，用模型筛选、归并、写中文摘要，计算信号置信度与行业趋势，出日报周报月报，并通过网站、RSS、公开 API、Agent Markdown 和 MCP 对外提供。先读 README，再按任务读 `docs/` 里对应的文档。

## 本站的组成

- `site/`：本站身份与品牌——站名文案（`site.ts`）、模型（`models.ts`）、品牌（`brand/`）、条款页（`pages/`）、根目录文件（`public/`）、更新日志（`changelog.json`）、启用的模块（`modules/`）
- `industry/`：投资行业包——分类标签（`taxonomy.ts`）、主题（`topics.json`）、信源（`sources.json`）、提示词（`prompts/`）、门槛（`selection.ts`）、金标示例（`*.example.jsonl`）
- `modules/invest-signals/`：投资专属模块——`/signals` 信号置信度榜与 `/trends` 行业趋势，见模块内注释与 `docs/architecture.md` 的“模块”
- `modules/macro-dashboard/`：宏观仪表盘——`/dashboard` 五块图与 `/dashboard/report` 每日 PEST 分析。指标清单在 `indicators.ts`（加指标只改这里），周期滤波在 `logic.ts`（纯函数，有单测），采集在 `collect/`（FRED、世界银行、第三方行情），报告在 `report.ts` 与 `prompts/pest*.md`
- `scripts/nameplates-from-assets.ts`、`scripts/make-icons.ts`：本站的品牌生成脚本（报头字、图标）

还带着上游名字、但故意没改的地方（改了就失去与上游引擎合并的能力，要改就一次性整体改）：包名作用域 `@aihot/*`、环境变量 `AIHOT_DATA_DIR`/`AIHOT_CREDENTIALS_DIR`/`AIHOT_ENVIRONMENT`/`AIHOT_RELEASE`、后台会话 Cookie `aihot_admin`、浏览器本地存储的 `aihot:*` 键、SSR 请求头 `x-aihot-ssr`。对外可见的接口字段已经换成与站无关的写法（条目链接是 `links.site`）。

## 最常见的任务

### 增删信源

后台“信源”页管理；预置清单在 `industry/sources.json`（首次启动导入，已存在的不覆盖）。所有预置地址都经过实测；新增 RSS/JSON 信源前先用 `curl` 验证可用。 SEC 的 EDGAR 与部分来源要求 User-Agent 带联系方式（`SITE.crawlerName` 已按此配置）。

### 改精选口味

提示词在 `industry/prompts/`，门槛在 `industry/selection.ts`。改评分标准时保留原有结构（内容类型、八个类型加权、五轴、噪声压制、安全边界），替换的是“什么算重要”“什么算噪声”的例子。合规边界不能动：`content-understanding.md` 里“不给投资建议”是硬规则。门槛要用标注样本重新校准（`docs/selection.md`），不要凭感觉改数字。

### 加分析指标

置信度与趋势的算法在 `modules/invest-signals/logic.ts`（纯函数，有单测）。改算法要同步改页面上的“怎么算的”说明，保持公式对读者透明。不要把它改成涨跌预测——本站的定位是信息聚合与可核查性，不是投资建议。

宏观仪表盘的指标在 `modules/macro-dashboard/indicators.ts`，加一个指标只在这里加一行（采集、接口、页面、报告都从它读）。三处不能含糊：
- 序列必须是真能自动取到的（FRED/世行/行情接口），实测过再写进去，不要写没验证过的 series id；
- 经济周期的三个频带用 `logic.ts` 的 CF 带通滤波，长波的末端必然是估计值，图上一律按虚线画、写明会随新数据修正，不能把估计值画成实测值；
- 报告只写 PEST 四个象限的事实与观察，不写买卖指向、目标价、收益承诺；数据快照和报告一起存，读者能核对。

### 加新功能

框架里没有、只有本站要的功能，做成模块放进 `modules/`（一个功能一个文件夹），在 `site/modules/` 三份清单和 `site/package.json` 里登记，Dockerfile 里加一行 COPY。通常不需要改 `apps/` 和 `packages/`。

这些事要问使用者本人，不要替他决定：站名与定位；要盯哪些信源；什么消息重要、什么是噪声；分类怎么分；条款和隐私说明的内容（上线前需要他本人确认）。

## 运行与检查

Node.js 24 直接运行 TypeScript，后端没有构建步骤。npm workspaces：`apps/*`、`packages/*`、`industry`、`site`、`modules/*`。

```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 库名必须以 _test 或 _ci 结尾；账号要能建库
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
npm run test:standalone                                       # 不需要数据库的测试（含模块纯函数测试）
node scripts/smoke.ts --base http://localhost:3000            # 站点跑起来以后
```

## 要守住的规则

（引擎的规则原样保留：前端只通过 HTTP 读 api；公开出口都从 `publication/` 读；页面不调模型；付费请求走回执与预算熔断；安全阀默认关；信源默认只展示摘要；公开内容匿名；改动要连代码、测试、文档、状态一起删；迁移约定；不提交 `.env` 与 `.data/`。）

本站额外遵守：

- **不构成投资建议**：站点任何位置（页面、RSS、API、MCP、推送、报告）都不得出现买入/卖出/持有等操作建议、目标价或收益承诺。信号置信度只衡量信息的可核查程度，行业趋势只衡量信源范围内的关注度变化，页面文案必须保持这个口径。
- **信源高置信度**：预置信源只收官方一手、持牌媒体与专业研究；不入荐股群、喊单、来源不明的自媒体。新增信源前先验证可达与内容形态。
- **数字忠实**：模型摘要保留原文数字与单位，不换算、不改写量级（`rules-domain.md`）。

## 写代码

匹配周围代码的写法、命名和注释密度。选能清楚解决问题的简单方案，只定义正在使用的抽象。验证改动涉及的重要行为，不为简单的样式改动写测试。
