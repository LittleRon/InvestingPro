// 本站运行的模块（modules/<名字>/，见 docs/architecture.md）。每个模块在它有的清单里各占一行：
// 这里列地址（module.ts），server.ts 列后端，web.ts 列网页。清单的顺序就是入口在站上出现的顺序。
import type { ModuleDeclaration } from "@aihot/contracts/modules";
import macroDashboard from "@aihot/macro-dashboard";
import investSignals from "@aihot/invest-signals";

export const MODULES: readonly ModuleDeclaration[] = [macroDashboard, investSignals];
