// 宏观仪表盘接进网页的地方：桌面侧栏“分析”一组的第一项（和信号、趋势同一组，
// 引擎按组名合并），手机底栏保持精选/热点/日报/我的四格不变，入口放在“我的”页。
import { defineWebModule } from "@aihot/web/modules";
import { IconGrid } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "macro-dashboard",
  sidebar: {
    section: "分析",
    items: [{ to: "/dashboard", label: "宏观仪表盘", icon: IconGrid }],
  },
  tools: [{ to: "/dashboard", label: "宏观仪表盘", icon: <IconGrid size={18} /> }],
});
