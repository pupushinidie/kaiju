/**
 * 像素美术的地址（规格见 art/spec.md）。图片放在 public/art 下。
 * 同一屏所有像素图用同一个整数倍：桌面 2×、手机 1×，CSS image-rendering: pixelated。
 */
import type { CardId, Face, MonsterId } from "@kaiju/game";

const ROOT = `${import.meta.env.BASE_URL}art/`;

/** 六只怪兽：名字和队伍色。 */
export const MONSTERS: Record<MonsterId, { readonly name: string; readonly hex: string }> = {
  deer: { name: "团团鹿", hex: "#e8704f" },
  jelly: { name: "啵啵冻", hex: "#a57fdc" },
  robot: { name: "铁罐丁", hex: "#36b9c4" },
  cloud: { name: "轰隆云", hex: "#f2c63a" },
  moss: { name: "苔石墩", hex: "#78c257" },
  crab: { name: "钳钳蟹", hex: "#4a7fe0" },
};

export const monsterArt = {
  full: (id: MonsterId) => `${ROOT}monsters/${id}.png`,
  idle: (id: MonsterId) => `${ROOT}monsters/${id}-idle.png`,
  mini: (id: MonsterId) => `${ROOT}monsters/${id}-mini.png`,
  ko: (id: MonsterId) => `${ROOT}monsters/${id}-mini-ko.png`,
  icon: (id: MonsterId) => `${ROOT}monsters/${id}-icon.png`,
};
export const IDLE_FRAMES = 8;
export const IDLE_FRAME_MS = 150;

export const bgArt = { night: `${ROOT}bg/night@3x.png`, day: `${ROOT}bg/day@3x.png` };

export const boardArt = {
  heart: `${ROOT}board/heart.png`,
  harbor: `${ROOT}board/harbor.png`,
  glowHeart: `${ROOT}board/glow-heart.png`,
  glowHarbor: `${ROOT}board/glow-harbor.png`,
};

/** 骰子：白骰 w-、绿骰 g-（额外脑袋）。 */
export const dieArt = (face: Face | null, green = false) => `${ROOT}dice/${green ? "g" : "w"}-${face ?? "blank"}.png`;

export const iconArt = {
  energy: `${ROOT}icons/energy.png`,
  heart: `${ROOT}icons/heart.png`,
  star: `${ROOT}icons/star.png`,
  claw: `${ROOT}icons/claw.png`,
  crown: `${ROOT}icons/crown.png`,
  trophy: `${ROOT}ui/trophy.png`,
};

export const tokenArt = {
  poison: `${ROOT}tokens/poison.png`,
  shrink: `${ROOT}tokens/shrink.png`,
  smoke: `${ROOT}tokens/smoke.png`,
  mimic: `${ROOT}tokens/mimic.png`,
};

export const cardArt = {
  full: (id: CardId) => `${ROOT}cards/full/${id}.png`,
  art: (id: CardId) => `${ROOT}cards/art/${id}.png`,
  thumb: (id: CardId) => `${ROOT}cards/thumb/${id}.png`,
  back: `${ROOT}cards/back.png`,
};

export const fxArt = {
  claw: { src: `${ROOT}fx/claw.png`, frames: 7, size: [64, 64] as const, ms: 70 },
  enter: { src: `${ROOT}fx/enter.png`, frames: 8, size: [160, 64] as const, ms: 80 },
  ko: { src: `${ROOT}fx/ko.png`, frames: 9, size: [96, 96] as const, ms: 90 },
};
