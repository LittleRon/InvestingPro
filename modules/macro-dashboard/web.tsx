// 宏观仪表盘接进网页的地方：桌面侧栏“分析”一组的第一项（和信号、趋势同一组，
// 引擎按组名合并），手机底栏保持精选/热点/日报/我的四格不变，入口放在“我的”页。
import { defineWebModule } from "@aihot/web/modules";
import { IconGrid, IconChart } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "macro-dashboard",
  sidebar: {
    section: "分析",
    items: [
      { to: "/dashboard", label: "宏观仪表盘", icon: IconGrid },
      { to: "/dashboard/clock", label: "投资时钟", icon: IconGrid },
      { to: "/dashboard/allocation", label: "组合配置", icon: IconChart },
    ],
  },
  tools: [
    { to: "/dashboard", label: "宏观仪表盘", icon: <IconGrid size={18} /> },
    { to: "/dashboard/clock", label: "投资时钟", icon: <IconGrid size={18} /> },
    { to: "/dashboard/allocation", label: "组合配置", icon: <IconChart size={18} /> },
  ],
});
