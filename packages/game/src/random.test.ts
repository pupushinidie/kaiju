import { describe, expect, it } from "vitest";
import { DECK_SIZE } from "./cards.js";
import { actorId, apply, createGame, legalActions, maxLifeOf, timeoutTurn } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import type { GameCommand, GameState } from "./types.js";

const GAMES_PER_COUNT = 300;
const MAX_COMMANDS = 4000;

/** 不变量：用普通代码检查，返回问题描述（没问题返回 null）。 */
function check(state: GameState): string | null {
  const uids: string[] = [];
  for (const card of state.deck) uids.push(card.uid);
  for (const card of state.market) if (card) uids.push(card.uid);
  for (const card of state.discard) uids.push(card.uid);
  for (const player of state.players) for (const card of player.cards) uids.push(card.uid);
  if (uids.length !== DECK_SIZE) return `卡牌总数 ${uids.length}`;
  if (new Set(uids).size !== DECK_SIZE) return "有重复的卡";
  if (state.deckCount !== state.deck.length) return "deckCount 不对";
  for (const player of state.players) {
    if (player.vp < 0 || player.energy < 0 || player.poison < 0 || player.shrink < 0) return `${player.id} 有负数`;
    if (player.alive) {
      if (player.life <= 0 || player.life > maxLifeOf(state, player)) return `${player.id} 生命 ${player.life}`;
    } else if (player.location || player.cards.length > 0 || player.energy > 0) return `${player.id} 出局了还占着东西`;
    if (player.location && state[player.location] !== player.id) return `${player.id} 位置不一致`;
    for (const card of player.cards) {
      if (card.id === "smoke-cloud" && !((card.smoke ?? 0) > 0)) return "烟雾用完没弃";
    }
  }
  for (const spot of ["city", "bay"] as const) {
    const id = state[spot];
    if (id) {
      const occupant = state.players.find((player) => player.id === id);
      if (!occupant?.alive || occupant.location !== spot) return `${spot} 里的人不对`;
    }
  }
  if (state.bay && !state.bayOpen) return "港湾关了还有人";
  if (state.city && state.city === state.bay) return "同时占城心和港湾";
  const alive = state.players.filter((player) => player.alive).length;
  if (state.bayOpen && alive <= 4) return "活着 4 只以下港湾还开着";
  if (state.phase === "playing") {
    if (alive < 2) return "只剩一只还没结束";
    if (!state.players[state.currentPlayer]!.alive) return "当前玩家已出局";
    if (state.stage === "prompt" && !state.prompt) return "prompt 阶段没有问题";
    if (state.prompt && state.stage !== "prompt") return "有问题但不在 prompt 阶段";
    if (state.queue.length > 0 && !state.prompt) return "队列没跑完";
    const actor = actorId(state);
    if (legalActions(state, actor).filter((command) => command.type !== "RAPID_HEAL").length === 0) return `${actor} 没有合法动作`;
  } else {
    if (!state.finalResult) return "结束了没有结果";
    for (const winner of state.finalResult.winners) {
      const player = state.players.find((candidate) => candidate.id === winner)!;
      if (!player.alive) return "赢家已出局";
      if (state.finalResult.reason === "vp" && player.vp < state.config.winVp) return "分数不够也赢了";
    }
    if (state.finalResult.reason === "lastStanding" && alive !== 1) return "最后一只但不止一只";
    if (state.finalResult.reason === "allDead" && alive !== 0) return "全倒但还有活的";
  }
  return null;
}

function randomCommand(state: GameState, actor: string, rng: Rng): GameCommand {
  const options = legalActions(state, actor).filter((command) => command.type !== "RAPID_HEAL");
  // 掷骰阶段再加一些随机留骰
  if (state.stage === "roll" && state.turnState.rolls > 0 && state.turnState.rollsLeft > 0 && rng.next() < 0.5) {
    const keep = state.turnState.dice.map((_, i) => i).filter(() => rng.next() < 0.5);
    if (keep.length < state.turnState.dice.length) return { type: "ROLL", keep };
  }
  // 买牌阶段别太早结束：有能量时偏向买
  if (state.stage === "buy") {
    const buys = options.filter((command) => command.type !== "END_TURN");
    if (buys.length > 0 && rng.next() < 0.6) return rng.pick(buys);
  }
  return rng.pick(options);
}

function playRandomGame(players: number, seed: number): { problem: string | null; commands: number; state: GameState } {
  const rng = createRng(seed * 7919 + players);
  let state = createGame(Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` })), seed);
  let problem = check(state);
  let commands = 0;
  while (!problem && state.phase === "playing" && commands < MAX_COMMANDS) {
    commands += 1;
    // 偶尔有人轮外用快速治疗
    if (rng.next() < 0.05) {
      for (const player of state.players) {
        const heal = legalActions(state, player.id).find((command) => command.type === "RAPID_HEAL");
        if (heal) {
          state = apply(state, player.id, heal, rng).state;
          break;
        }
      }
    }
    if (rng.next() < 0.03) {
      state = timeoutTurn({ ...state, rngState: rng.state });
    } else {
      const actor = actorId(state);
      const command = randomCommand(state, actor, rng);
      try {
        state = apply(state, actor, command, rng).state;
      } catch (error) {
        problem = `合法动作被拒绝：${JSON.stringify(command)} ${(error as Error).message}`;
        break;
      }
    }
    problem = check(state);
  }
  if (!problem && state.phase !== "finished") problem = `${MAX_COMMANDS} 步还没结束`;
  return { problem, commands, state };
}

describe("随机对局（每种人数 300 局）", () => {
  for (const players of [2, 3, 4, 5, 6]) {
    it(`${players} 人：不卡死、配件守恒、终局能判定`, () => {
      const problems: string[] = [];
      const reasons = new Map<string, number>();
      let total = 0;
      for (let game = 0; game < GAMES_PER_COUNT; game += 1) {
        const result = playRandomGame(players, game + 1);
        total += result.commands;
        if (result.problem) problems.push(`种子 ${game + 1}：${result.problem}`);
        const reason = result.state.finalResult?.reason ?? "none";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      expect(problems.slice(0, 5)).toEqual([]);
      expect(total / GAMES_PER_COUNT).toBeGreaterThan(10);
    }, 240_000);
  }
});
