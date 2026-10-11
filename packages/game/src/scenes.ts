/**
 * 预览局面工厂（界面、教程、测试都用）：
 * - buildState(spec)：按参数造任意精确局面（人数、谁的回合、每只怪兽的生命/分/能量/位置/卡/标记、公开卡、牌堆顶、骰子、阶段）；
 * - scene(name)：按名字造常见局面，名字见 SCENE_NAMES。
 * 造出来的局面卡牌守恒（卡从牌堆里拿），可以直接接着 apply。
 */
import { CARDS, type CardId } from "./cards.js";
import { applyCommand, createGame, freshTurn, timeoutTurn } from "./engine.js";
import { scriptedRng } from "./rng.js";
import { apply } from "./engine.js";
import type { CardInstance, Face, GameCommand, GameState, MonsterId, Spot } from "./types.js";

export interface PlayerSpec {
  readonly name?: string;
  readonly monster?: MonsterId;
  readonly life?: number;
  readonly vp?: number;
  readonly energy?: number;
  readonly location?: Spot | null;
  readonly cards?: readonly CardId[];
  readonly poison?: number;
  readonly shrink?: number;
  readonly alive?: boolean;
}

export interface StateSpec {
  /** 人数，默认 4。玩家 id 是 p1…p6，座位 0…5。 */
  readonly players?: number;
  readonly seed?: number;
  /** 当前回合玩家的座位，默认 0。 */
  readonly current?: number;
  /** 按座位改玩家。 */
  readonly p?: Readonly<Record<number, PlayerSpec>>;
  /** 公开的 3 张（null = 空格）。 */
  readonly market?: readonly (CardId | null)[];
  /** 牌堆顶依次是这些卡。 */
  readonly deckTop?: readonly CardId[];
  /** 已经掷出的骰子（roll 阶段）。 */
  readonly dice?: readonly Face[];
  /** 已经掷了几次 / 还剩几次，默认掷过 1 次。 */
  readonly rolls?: number;
  readonly rollsLeft?: number;
  /** roll（默认）或 buy（骰子已结算）。 */
  readonly stage?: "roll" | "buy";
  readonly turn?: number;
  readonly twoPlayerEnergy?: boolean;
}

export const PLAYER_NAMES = ["小明", "阿花", "大壮", "咕噜一号", "咕噜二号", "咕噜三号"];

/** 从牌堆（找不到再从公开牌、弃牌堆）拿出一张指定的卡。 */
function takeCard(state: GameState, id: CardId): CardInstance {
  const fromDeck = state.deck.findIndex((card) => card.id === id);
  if (fromDeck >= 0) return state.deck.splice(fromDeck, 1)[0]!;
  const slot = state.market.findIndex((card) => card?.id === id);
  if (slot >= 0) {
    const card = state.market[slot]!;
    state.market[slot] = state.deck.shift() ?? null;
    return card;
  }
  const fromDiscard = state.discard.findIndex((card) => card.id === id);
  if (fromDiscard >= 0) return state.discard.splice(fromDiscard, 1)[0]!;
  throw new Error(`牌堆里已经没有 ${id} 了。`);
}

export function buildState(spec: StateSpec = {}): GameState {
  const count = spec.players ?? 4;
  const players = Array.from({ length: count }, (_, seat) => ({
    id: `p${seat + 1}`,
    name: spec.p?.[seat]?.name ?? PLAYER_NAMES[seat]!,
    monster: spec.p?.[seat]?.monster,
  }));
  const state = createGame(players, spec.seed ?? 7, spec.twoPlayerEnergy === undefined ? {} : { twoPlayerEnergy: spec.twoPlayerEnergy });
  state.events = [];
  state.recent = [];
  // 公开牌先放回牌堆，最后再按 spec 摆
  if (spec.market) {
    for (const card of state.market) if (card) state.deck.push(card);
    state.market = [null, null, null];
  }
  state.players.forEach((player, seat) => {
    const ps = spec.p?.[seat];
    if (!ps) return;
    if (ps.life !== undefined) player.life = ps.life;
    if (ps.vp !== undefined) player.vp = ps.vp;
    if (ps.energy !== undefined) player.energy = ps.energy;
    if (ps.poison !== undefined) player.poison = ps.poison;
    if (ps.shrink !== undefined) player.shrink = ps.shrink;
    if (ps.alive === false) {
      player.alive = false;
      player.life = 0;
    }
    for (const id of ps.cards ?? []) {
      const card = takeCard(state, id);
      if (id === "smoke-cloud") card.smoke = 3;
      if (id === "monster-batteries") card.battery = 6;
      player.cards.push(card);
    }
    if (ps.location) {
      player.location = ps.location;
      state[ps.location] = player.id;
    }
  });
  if (spec.market) {
    state.market = spec.market.map((id) => (id ? takeCard(state, id) : null));
  } else {
    for (let slot = 0; slot < 3; slot += 1) if (!state.market[slot]) state.market[slot] = state.deck.shift() ?? null;
  }
  if (spec.deckTop) {
    const top = spec.deckTop.map((id) => takeCard(state, id));
    state.deck.unshift(...top);
  }
  state.deckCount = state.deck.length;
  state.currentPlayer = spec.current ?? 0;
  if (spec.turn !== undefined) state.turn = spec.turn;
  const current = state.players[state.currentPlayer]!;
  state.turnState = freshTurn(state, current, 0);
  if (spec.dice) {
    state.turnState.dice = spec.dice.map((face, i) => ({ face, green: i >= 6 }));
    state.turnState.rolls = spec.rolls ?? 1;
    state.turnState.rollsLeft = spec.rollsLeft ?? Math.max(0, 3 - (spec.rolls ?? 1));
  }
  if (spec.stage === "buy") {
    state.stage = "buy";
    state.turnState.resolved = true;
    if (!spec.dice) {
      state.turnState.dice = state.turnState.dice.map((die) => ({ ...die, face: "energy" }));
      state.turnState.rolls = 1;
      state.turnState.rollsLeft = 2;
    }
  }
  state.bayOpen = state.players.filter((player) => player.alive).length >= 5;
  return state;
}

/** 用剧本骰子执行一条命令（预览和教程用）。 */
export function applyScripted(state: GameState, playerId: string, command: GameCommand, faces: readonly string[] = []): GameState {
  const { state: next } = apply(state, playerId, command, scriptedRng(faces, state.version + 11));
  return next;
}

export const SCENE_NAMES = [
  "start", "start2", "start6", "rolled", "lastRoll", "resolveEnter", "yield", "yieldJets", "wings",
  "buy", "buyRich", "buyLab", "buyTentacles", "mimicChoice", "cityFull6", "poisoned", "zeroDice",
  "offline", "timeout", "eliminated", "bigTable", "endVp", "endTie", "endLast", "endAllDead",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

const ALL_KEEP: CardId[] = (Object.keys(CARDS) as CardId[]).filter((id) => CARDS[id].kind === "keep");

export function scene(name: SceneName): GameState {
  switch (name) {
    case "start":
      return buildState({ players: 4 });
    case "start2":
      return buildState({ players: 2 });
    case "start6":
      return buildState({ players: 6 });
    case "rolled":
      return buildState({ players: 4, dice: ["3", "3", "claw", "energy", "1", "heart"], rolls: 1, rollsLeft: 2 });
    case "lastRoll":
      return buildState({ players: 4, dice: ["3", "3", "3", "claw", "energy", "heart"], rolls: 2, rollsLeft: 1, p: { 1: { location: "city", vp: 6 } } });
    case "resolveEnter": {
      const state = buildState({ players: 4, dice: ["3", "3", "3", "claw", "energy", "energy"], rolls: 3, rollsLeft: 0 });
      return applyCommand(state, "p1", { type: "RESOLVE" });
    }
    case "yield": {
      const state = buildState({ players: 4, current: 1, dice: ["claw", "claw", "energy", "1", "2", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", vp: 8, life: 7 } } });
      return applyCommand(state, "p2", { type: "RESOLVE" });
    }
    case "yieldJets": {
      const state = buildState({ players: 4, current: 1, dice: ["claw", "claw", "claw", "1", "2", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", life: 5, cards: ["jets"] } } });
      return applyCommand(state, "p2", { type: "RESOLVE" });
    }
    case "wings": {
      const state = buildState({ players: 4, current: 1, dice: ["claw", "claw", "energy", "1", "2", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", energy: 4, cards: ["wings"] } } });
      return applyCommand(state, "p2", { type: "RESOLVE" });
    }
    case "buy":
      return buildState({ players: 4, stage: "buy", market: ["skyscraper", "extra-head", "heal"], p: { 0: { energy: 7, vp: 5 }, 1: { location: "city", vp: 9 } } });
    case "buyRich":
      return buildState({ players: 4, stage: "buy", market: ["energize", "mimic", "it-has-a-child"], p: { 0: { energy: 14, cards: ["alien-metabolism", "giant-brain"] } } });
    case "buyLab":
      return buildState({ players: 4, stage: "buy", deckTop: ["frenzy"], p: { 0: { energy: 9, cards: ["made-in-a-lab"] } } });
    case "buyTentacles":
      return buildState({ players: 4, stage: "buy", p: { 0: { energy: 10, cards: ["parasitic-tentacles", "metamorph"] }, 2: { cards: ["armor-plating", "spiked-tail"] } } });
    case "mimicChoice":
      return buildState({ players: 4, stage: "buy", market: ["mimic", "corner-store", "tanks"], p: { 0: { energy: 9 }, 1: { cards: ["extra-head", "regeneration"] }, 3: { cards: ["acid-attack"] } } });
    case "cityFull6":
      return buildState({ players: 6, current: 2, dice: ["claw", "claw", "claw", "energy", "3", "3"], rolls: 1, rollsLeft: 2, p: { 0: { location: "city", vp: 11 }, 1: { location: "bay", vp: 7 } } });
    case "poisoned":
      return buildState({ players: 4, stage: "buy", p: { 0: { poison: 2, shrink: 1, life: 6 }, 2: { cards: ["poison-spit", "shrink-ray"] } } });
    case "zeroDice": {
      // 缩小标记 6 个：一颗骰子都没有，回合一开始直接结算（进城心）
      const state = buildState({ players: 3, current: 0, stage: "buy", p: { 0: { location: "city" }, 1: { shrink: 6 } } });
      return applyCommand(state, "p1", { type: "END_TURN" });
    }
    case "offline":
      // 对手离线是房间层面的（connected=false），局面就是普通的对手回合
      return buildState({ players: 4, current: 2, dice: ["1", "1", "heart", "claw", "energy", "3"], rolls: 1, rollsLeft: 2 });
    case "timeout": {
      const state = buildState({ players: 4, current: 0 });
      return timeoutTurn(state);
    }
    case "eliminated":
      return buildState({ players: 4, current: 0, p: { 2: { alive: false }, 1: { location: "city", life: 3 } } });
    case "bigTable":
      return buildState({
        players: 6,
        current: 3,
        dice: ["claw", "claw", "3", "3", "3", "energy", "heart", "1"],
        rolls: 2,
        rollsLeft: 1,
        p: {
          0: { location: "city", vp: 17, life: 4, cards: ALL_KEEP.slice(0, 6), poison: 2 },
          1: { location: "bay", vp: 12, life: 9, energy: 23, cards: ALL_KEEP.slice(6, 10) },
          2: { vp: 19, life: 2, cards: [ALL_KEEP[10]!, ...ALL_KEEP.slice(13, 15)], shrink: 3 },
          3: { vp: 8, life: 10, energy: 6, cards: ["extra-head", "extra-head", ...ALL_KEEP.slice(15, 19)] },
          4: { alive: false },
          5: { vp: 0, life: 12, cards: ["even-bigger", ...ALL_KEEP.slice(19, 23)] },
        },
      });
    case "endVp": {
      const state = buildState({ players: 4, stage: "buy", p: { 0: { vp: 21, location: "city", cards: ["urbavore"] }, 1: { vp: 14 }, 2: { vp: 9, alive: false }, 3: { vp: 3 } } });
      return applyCommand(state, "p1", { type: "END_TURN" });
    }
    case "endTie": {
      const state = buildState({ players: 3, stage: "buy", p: { 0: { vp: 20 }, 1: { vp: 20, cards: ["eater-of-the-dead"] }, 2: { vp: 12 } } });
      return applyCommand(state, "p1", { type: "END_TURN" });
    }
    case "endLast": {
      const state = buildState({ players: 3, current: 0, dice: ["claw", "claw", "claw", "energy", "energy", "1"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", vp: 6 }, 1: { life: 2 }, 2: { alive: false } } });
      return applyCommand(state, "p1", { type: "RESOLVE" });
    }
    case "endAllDead": {
      const state = buildState({ players: 2, stage: "buy", market: ["high-altitude-bombing", "heal", "tanks"], p: { 0: { life: 3, energy: 4 }, 1: { life: 2 } } });
      const bomb = state.market[0]!.uid;
      return applyCommand(state, "p1", { type: "BUY", uid: bomb });
    }
  }
}
