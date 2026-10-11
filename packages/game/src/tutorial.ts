/**
 * 新手教程的剧本（巨兽之城）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：骰子按 TUTORIAL_DICE 出，三只人机按剧本走，
 * 所以「凑出三个 3 进城心」「被打一下弹出让位」「买摩天楼 +4 分」这几幕一定会发生。
 * 剧本走完接练习局：对手交给人机，骰子换成普通随机数。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { fullDeck } from "./cards.js";
import { actorId, cardPrice, createGame } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import { buildState } from "./scenes.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。
   * players、my-panel、city-heart、dice、market、card-0、buy-0、roll-button、reroll-button、resolve-button、end-turn、yield-no、turn。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
/** 剧本里要买的那张摩天楼（公开卡第一张）。 */
export const TUTORIAL_SKYSCRAPER = fullDeck().find((card) => card.id === "skyscraper")!.uid;
export const TUTORIAL_BOTS = [
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
  { id: "p4", name: "咕噜三号" },
] as const;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "players",
    say: "每人一只怪兽，先到 20 分的赢。",
    note: "把别的怪兽全打倒（生命到 0）也算赢。左边是大家的生命、分数和能量。",
  },
  { kind: "do", id: "roll", lesson: "掷骰和留骰", anchor: "roll-button", expect: { type: "ROLL" }, say: "点「掷骰子」，一次掷 6 颗。" },
  {
    kind: "do", id: "keep", anchor: "dice", expect: { type: "ROLL", keep: [0, 1] },
    say: "点两颗 3 把它们留下，再点「重掷 4 颗」。",
    note: "留下的骰子有金框。一回合最多重掷 2 次，留下的也可以再点一下拿起来重掷。",
  },
  {
    kind: "info", id: "numbers", lesson: "骰子六种面", anchor: "dice", face: "happy",
    say: "凑出三个 3 了！三个一样的数字才得分。",
    note: "三个 3 是 3 分（不是 9 分），第四个 3 再 +1；只有两个 3 就是 0 分。",
  },
  {
    kind: "info", id: "faces", anchor: "dice",
    say: "闪电一颗 1 能量，心一颗回 1 血，爪打人。",
    note: "能量攒着买卡；生命上限 10。爪：在城外打城心里的怪兽，在城心里打城外的所有怪兽。",
  },
  {
    kind: "do", id: "resolve", anchor: "resolve-button", expect: { type: "RESOLVE" },
    say: "这把不错，点「结算」。",
    note: "城心现在空着，你的爪没有目标，这一下不算。",
  },
  {
    kind: "info", id: "city", lesson: "城心", anchor: "city-heart", face: "happy",
    say: "城心空着，结算完就必须进去：+1 分。",
    note: "回合开始还在城心再 +2 分。可城心里的怪兽挨城外所有人的打，也不能用心回血。",
  },
  {
    kind: "do", id: "end1", anchor: "end-turn", expect: { type: "END_TURN" },
    say: "能量还不够买卡，点「结束回合」。",
  },
  {
    kind: "watch", id: "rival", lesson: "让位",
    say: "轮到咕噜一号了，它在城外，爪会打城心里的你。",
    moves: [{ type: "ROLL" }, { type: "RESOLVE" }],
  },
  {
    kind: "info", id: "hit", anchor: "my-panel", face: "surprised",
    say: "你挨了 2 下！在城心挨了爪，可以选让位。",
    note: "让位：把城心让给打你的怪兽，伤害照吃，回到城外能用心回血。留下：下回合开始 +2 分，但继续挨打。",
  },
  {
    kind: "do", id: "stay", anchor: "yield-no", expect: { type: "YIELD", yield: false },
    say: "你还有 8 血，选「留下」赌一把。",
    note: "血少的时候让位更稳。注意：只有被爪打中才能让位，卡牌造成的伤害不能让位。",
  },
  {
    kind: "watch", id: "others",
    say: "看看另外两只咕噜怎么走。",
    moves: [
      { type: "END_TURN" },
      { type: "ROLL" }, { type: "RESOLVE" }, { type: "END_TURN" },
      { type: "ROLL" }, { type: "RESOLVE" }, { type: "END_TURN" },
    ],
  },
  {
    kind: "info", id: "start-bonus", anchor: "my-panel", face: "happy",
    say: "回合开始你还在城心：+2 分！",
    note: "所以城心很值钱，大家都想把你打出去。",
  },
  { kind: "do", id: "roll2", anchor: "roll-button", expect: { type: "ROLL" }, say: "再点「掷骰子」。" },
  {
    kind: "info", id: "hearts-in-city", anchor: "dice", face: "think",
    say: "4 个闪电，好运！这颗心在城心里没用。",
    note: "城心里的爪会打城外的每一只怪兽，一下打 3 只。",
  },
  { kind: "do", id: "resolve2", anchor: "resolve-button", expect: { type: "RESOLVE" }, say: "点「结算」，拿 4 能量。" },
  {
    kind: "info", id: "market", lesson: "买超能力卡", anchor: "card-0",
    say: "能量可以买这 3 张超能力卡，左上角是价格。",
    note: "「保留」卡买下后一直生效；「一次性」卡立刻生效然后弃掉。花 2 能量可以把 3 张换一批。点卡能看大图。",
  },
  {
    kind: "do", id: "buy", anchor: "buy-0", expect: { type: "BUY", uid: TUTORIAL_SKYSCRAPER },
    say: "你有 6 能量，买下「摩天楼」：+4 分。",
  },
  {
    kind: "do", id: "end2", anchor: "end-turn", expect: { type: "END_TURN" },
    say: "买完了，点「结束回合」。",
  },
  {
    kind: "info", id: "win", lesson: "怎样获胜", anchor: "players", face: "think",
    say: "到 20 分要撑过这个回合才算赢。",
    note: "同一回合被打到 0 血就不算；只剩最后一只还站着的怪兽也直接获胜。",
  },
  {
    kind: "info", id: "site", anchor: "turn",
    say: "真实对局里每一步都限时。",
    note: "掷骰 40 秒、让位 20 秒、买卡 30 秒；连续超时 2 次由人机托管替你打，点「取消托管」就能收回。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！",
    note: "接下来和三只咕噜把这局打完。拿不准的时候点「提示」（键盘 H），我告诉你我会怎么走。",
  },
];

/**
 * 剧本里每一颗骰子，按顺序（一颗骰子取一个面）：
 * 你：掷 6 颗 → 留两颗 3 重掷 4 颗；咕噜一号 2 爪打你；咕噜二号三个 1；咕噜三号没什么；你：4 闪电 + 心 + 爪。
 */
export const TUTORIAL_DICE: readonly string[] = [
  "3", "3", "claw", "energy", "1", "heart", // 你：第一次
  "3", "energy", "energy", "claw", // 你：重掷 4 颗 → 3 3 3 闪电 闪电 爪
  "claw", "claw", "energy", "1", "2", "heart", // 咕噜一号：2 爪
  "1", "1", "1", "energy", "heart", "2", // 咕噜二号：三个 1
  "2", "2", "3", "energy", "heart", "heart", // 咕噜三号
  "energy", "energy", "energy", "energy", "heart", "claw", // 你：第二回合
];

const FACE_ORDER = ["1", "2", "3", "energy", "heart", "claw"];

/** 教程开局：4 人局，你先手；公开卡第一张是摩天楼。 */
export function createTutorialGame(selfName: string): GameState {
  const state = buildState({ players: 4, current: 0, seed: 20261011, market: ["skyscraper", "heal", "extra-head"] });
  state.players = state.players.map((player, seat) => ({
    ...player,
    name: seat === 0 ? selfName : TUTORIAL_BOTS[seat - 1]!.name,
    monster: (["deer", "jelly", "robot", "cloud"] as const)[seat]!,
  }));
  state.events = [{ type: "TurnStarted", player: TUTORIAL_SELF }];
  state.recent = [];
  return state;
}

/** 练习局重开：4 人、随机先手、随机骰子。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_BOTS.map((bot) => ({ id: bot.id, name: bot.name }))], seed);
}

/** 剧本骰子：前面按 faces 出（每次 int(6) 取一颗），用完以后交给普通随机数。 */
export interface TutorialRng extends Rng {
  /** 还剩几颗剧本骰子。 */
  readonly remaining: number;
}

export function createTutorialRng(seed: number, faces: readonly string[] = TUTORIAL_DICE): TutorialRng {
  const queue = [...faces];
  const free = createRng(seed);
  return {
    next: () => free.next(),
    int: (max) => (max === 6 && queue.length > 0 ? FACE_ORDER.indexOf(queue.shift()!) : free.int(max)),
    pick: (items) => free.pick(items),
    shuffle: (items) => free.shuffle(items),
    get state() {
      return free.state;
    },
    get remaining() {
      return queue.length;
    },
  };
}

/** 两条命令是不是同一步：留骰比较留下哪几颗（不管顺序），买卡比较哪张。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "ROLL" && b.type === "ROLL") {
    const left = [...(a.keep ?? [])].sort().join(",");
    const right = [...(b.keep ?? [])].sort().join(",");
    return left === right && (a.use ?? "") === (b.use ?? "");
  }
  if (a.type === "BUY" && b.type === "BUY") return a.uid === b.uid;
  if (a.type === "YIELD" && b.type === "YIELD") return a.yield === b.yield;
  if (a.type === "WINGS" && b.type === "WINGS") return a.use === b.use;
  if (a.type === "CHANGE_DIE" && b.type === "CHANGE_DIE") return a.index === b.index && a.face === b.face && a.via === b.via;
  if ((a.type === "SELL" && b.type === "SELL") || (a.type === "MIMIC" && b.type === "MIMIC")) return JSON.stringify(a) === JSON.stringify(b);
  return true;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const playing = state.phase === "playing";
  const myAction = playing && actorId(state) === viewer;
  const myTurn = playing && state.players[state.currentPlayer]?.id === viewer;
  const ts = state.turnState;
  if (["players", "my-panel", "dice", "market", "turn", "prompt", "city", "log"].includes(anchor)) return true;
  if (anchor === "city-heart") return true;
  if (anchor === "harbor") return state.bayOpen;
  if (anchor === "roll-button") return myAction && state.stage === "roll" && ts.rolls === 0;
  if (anchor === "reroll-button") return myAction && state.stage === "roll" && ts.rolls > 0 && !ts.resolved;
  if (anchor === "resolve-button") return myAction && state.stage === "roll" && ts.rolls > 0 && !ts.resolved;
  if (anchor === "end-turn" || anchor === "sweep") return myAction && state.stage === "buy";
  if (anchor === "yield-no" || anchor === "yield-yes") return myAction && state.prompt?.kind === "yield";
  if (anchor.startsWith("card-")) return state.market[Number(anchor.slice(5))] != null;
  if (anchor.startsWith("buy-")) {
    const card = state.market[Number(anchor.slice(4))];
    const me = state.players.find((player) => player.id === viewer);
    return !!card && !!me && myAction && myTurn && state.stage === "buy";
  }
  if (anchor.startsWith("die-")) return Number(anchor.slice(4)) < ts.dice.length;
  return false;
}

/** 某张公开卡现在买得起吗（给提示用）。 */
export function affordable(state: GameState, viewer: string, slot: number): boolean {
  const card = state.market[slot];
  const me = state.players.find((player) => player.id === viewer);
  return !!card && !!me && cardPrice(state, me, card.id) <= me.energy;
}
