import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（巨兽之城，靛紫夜色 → 白底）。
 * 深色底、面板、按钮 → 白底浅色；深色像素描边保留；浅色字 → 深色字。
 * 卡面（羊皮纸上的深色字）、城心标签、横幅、玩家标签这些内容色不换。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "kaiju.css"],
  colors: {
    "#1b1428": "#ffffff", // 底色、输入框
    "#1f172e": "#faf7f2", // 底色的棋盘纹
    "#2b2140": "#fbf7f0", // 面板
    "#372a52": "#efe7f5", // 面板 2、分隔线
    "#42325f": "#e6dcf0", // 普通按钮、当前玩家
    "#2e2238": "#fbf3df", // 管理员区
    "#3a2c10": "#fcefc6", // 金色字的底
    "#110b18": "#2a1d33", // 像素描边
    "#6a578f": "#ffffff", // 面板亮边
    "#0d0914": "#d6c9e0", // 面板暗边
    "#8a76b0": "#ffffff", // 按钮亮边
    "#160f22": "#bba9cc", // 按钮暗边
  },
  text: {
    "#fbf1dc": "#2a1d33",
    "#bcaac8": "#6b5a7c",
    "#8a7a9c": "#a898b6", // 输入框占位字
    "#ff8fa3": "#c22d4f", // 生命数字
    "#8ff09d": "#1f8a45", // 能量数字
  },
  background: {
    "#fbf1dc": "#372a52",
  },
  values: {
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
  // 卡面、城心标签、横幅、玩家身上的彩色标签、飘字保持原色
  keep: [".kj-card", ".kj-spot-label", ".kj-banner", ".kj-tag", ".kj-float", ".kj-chip", ".kj-die", ".kj-fx", ".kj-occupant"],
};
