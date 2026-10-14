// Renders the two README banners (docs/assets/banner-light.png and banner-dark.png) from the site's
// brand: the wordmark, the headline, and the source-to-sections flow. Run after changing the copy:
// node scripts/make-banners.ts
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const W = 2400;
const H = 1200;

function banner(dark: boolean): string {
  const paper = dark ? "#101619" : "#faf9f7";
  const ink = dark ? "#eef3f4" : "#1a2126";
  const inkSoft = dark ? "#9fb0b6" : "#5b6a71";
  const accent = dark ? "#2ce2e8" : "#176b75";
  const line = dark ? "rgba(44,226,232,0.30)" : "rgba(23,107,117,0.28)";
  const nodeRing = dark ? "rgba(44,226,232,0.35)" : "rgba(23,107,117,0.30)";
  const chip = dark ? "rgba(44,226,232,0.12)" : "rgba(23,107,117,0.08)";
  const sections = ["宏观与政策", "市场动态", "公司与财报", "研究与观点"];
  const streams = Array.from({ length: 14 }, (_, i) => {
    const y0 = 180 + i * 62;
    return `<path d="M120 ${y0} C 700 ${y0}, 820 600, 1180 600" fill="none" stroke="${line}" stroke-width="2" />`;
  }).join("");
  const branches = sections.map((label, i) => {
    const y = 250 + i * 190;
    return `<path d="M1400 600 C 1650 600, 1700 ${y}, 1900 ${y}" fill="none" stroke="${line}" stroke-width="2" />
      <circle cx="1900" cy="${y}" r="7" fill="${accent}" />
      <text x="1935" y="${y + 9}" font-family="'Noto Sans SC', sans-serif" font-size="44" font-weight="700" fill="${ink}">${label}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${paper}" />
  <g transform="translate(110 130)">
    <rect x="0" y="0" width="86" height="86" rx="20" fill="${dark ? "#0b1012" : "#13191c"}" />
    <g fill="${accent}">
      <rect x="16" y="46" width="13" height="24" rx="3" opacity="0.5"/>
      <rect x="35" y="38" width="13" height="32" rx="3" opacity="0.72"/>
      <rect x="54" y="28" width="13" height="42" rx="3"/>
    </g>
    <path d="M12 40 L28 30 L40 36 L70 18" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="118" y="63" font-family="'Noto Sans SC', sans-serif" font-size="58" font-weight="900" letter-spacing="-1" fill="${ink}">InvestPro</text>
    <text x="120" y="98" font-family="'Noto Sans SC', sans-serif" font-size="24" font-weight="500" fill="${inkSoft}">投资信息采集与分析平台 · OPEN SOURCE · MIT</text>
  </g>
  <text x="110" y="430" font-family="'Noto Sans SC', sans-serif" font-size="120" font-weight="900" letter-spacing="-2" fill="${ink}">市场每天都有新动静，</text>
  <text x="110" y="580" font-family="'Noto Sans SC', sans-serif" font-size="120" font-weight="900" letter-spacing="-2" fill="${accent}">值得看的，只有几条。</text>
  <text x="110" y="680" font-family="'Noto Sans SC', sans-serif" font-size="40" font-weight="500" fill="${inkSoft}">盯住央行、监管、交易所与上市公司的一手信源，自动采集、精选、归并，</text>
  <text x="110" y="745" font-family="'Noto Sans SC', sans-serif" font-size="40" font-weight="500" fill="${inkSoft}">附信号置信度与行业趋势，每天 07:30 出一份日报。</text>
  <g font-family="'Noto Sans SC', sans-serif" font-size="30" font-weight="700">
    <rect x="110" y="850" width="290" height="64" rx="32" fill="${chip}" />
    <text x="150" y="892" fill="${accent}">01 一手信源</text>
    <rect x="430" y="850" width="290" height="64" rx="32" fill="${chip}" />
    <text x="470" y="892" fill="${accent}">02 模型精选</text>
    <rect x="750" y="850" width="290" height="64" rx="32" fill="${chip}" />
    <text x="790" y="892" fill="${accent}">03 信号与趋势</text>
  </g>
  ${streams}
  <circle cx="1400" cy="600" r="120" fill="none" stroke="${nodeRing}" stroke-width="2" />
  <circle cx="1400" cy="600" r="86" fill="${chip}" />
  <g fill="${accent}">
    <rect x="1352" y="616" width="16" height="34" rx="4" opacity="0.5"/>
    <rect x="1376" y="600" width="16" height="50" rx="4" opacity="0.72"/>
    <rect x="1400" y="582" width="16" height="68" rx="4"/>
  </g>
  <path d="M1344 596 L1370 578 L1394 588 L1432 552" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  ${branches}
  <text x="110" y="${H - 90}" font-family="'Noto Sans SC', sans-serif" font-size="28" font-weight="500" fill="${inkSoft}">InvestPro · 聚合公开信息 · 不构成投资建议</text>
</svg>`;
}

for (const dark of [false, true]) {
  const png = await sharp(Buffer.from(banner(dark))).png().toBuffer();
  writeFileSync(`docs/assets/banner-${dark ? "dark" : "light"}.png`, png);
  console.log(`docs/assets/banner-${dark ? "dark" : "light"}.png`, png.length, "bytes");
}
