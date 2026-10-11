import { describe, expect, it } from "vitest";
import { botCommand, botDecision } from "./bot.js";
import { actorId, applyCommand, createGame, redactGameForViewer } from "./engine.js";
import { buildState, scene } from "./scenes.js";
import type { GameState } from "./types.js";

const MAX_COMMANDS = 3000;

/** 人机只拿到 redact 后的状态；牌堆换成一碰就报错的代理，证明它不看牌堆。 */
function viewOf(state: GameState, id: string): GameState {
  const view = redactGameForViewer(state, id);
  const trap = new Proxy([], {
    get(target, key) {
      if (key === "length") return 0;
      if (typeof key === "symbol") return Reflect.get(target, key);
      throw new Error(`人机读了牌堆：${String(key)}`);
    },
  });
  return { ...view, deck: trap as unknown as GameState["deck"] };
}

describe("人机只用自己能看到的信息", () => {
  it("输入是 redact 后的状态；读牌堆会报错，但人机一路都没读", () => {
    for (const name of ["start", "rolled", "yield", "wings", "buy", "buyRich", "buyLab", "buyTentacles", "mimicChoice", "cityFull6"] as const) {
      const state = scene(name);
      const actor = actorId(state);
      expect(() => botCommand(viewOf(state, actor), actor)).not.toThrow();
      expect(botCommand(viewOf(state, actor), actor)).not.toBeNull();
    }
  });

  it("实验室出品：只看得到 redact 给它的牌堆顶", () => {
    const state = buildState({ stage: "buy", deckTop: ["skyscraper"], p: { 0: { energy: 6, vp: 17, cards: ["made-in-a-lab"] } } });
    const decision = botDecision(viewOf(state, "p1"), "p1")!;
    expect(decision.command).toMatchObject({ type: "BUY", uid: state.deck[0]!.uid });
  });
});

describe("关键决策", () => {
  it("让位：喷气式时不让就会倒下 → 让位", () => {
    const state = buildState({ current: 1, dice: ["claw", "claw", "claw", "1", "2", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", life: 3, cards: ["jets"] } } });
    const asked = applyCommand(state, "p2", { type: "RESOLVE" });
    expect(botDecision(viewOf(asked, "p1"), "p1")!.command).toEqual({ type: "YIELD", yield: true });
  });
  it("让位：血多 → 留下；血少 → 让位", () => {
    const high = applyCommand(buildState({ current: 1, dice: ["claw", "1", "2", "3", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", life: 10 } } }), "p2", { type: "RESOLVE" });
    expect(botCommand(viewOf(high, "p1"), "p1")).toEqual({ type: "YIELD", yield: false });
    const low = applyCommand(buildState({ current: 1, dice: ["claw", "claw", "2", "3", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", life: 5 } } }), "p2", { type: "RESOLVE" });
    const decision = botDecision(viewOf(low, "p1"), "p1")!;
    expect(decision.command).toEqual({ type: "YIELD", yield: true });
    expect(decision.reason).toContain("3 血");
  });
  it("让位：差 2 分就赢、血还够 → 留下赌回合开始的 +2", () => {
    const state = applyCommand(buildState({ current: 1, dice: ["claw", "1", "2", "3", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", life: 6, vp: 18 } } }), "p2", { type: "RESOLVE" });
    expect(botCommand(viewOf(state, "p1"), "p1")).toEqual({ type: "YIELD", yield: false });
  });
  it("双翼：会被打倒就用", () => {
    const state = applyCommand(buildState({ current: 1, dice: ["claw", "claw", "claw", "1", "2", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { location: "city", life: 3, energy: 2, cards: ["wings"] } } }), "p2", { type: "RESOLVE" });
    expect(state.prompt?.kind).toBe("wings");
    expect(botCommand(viewOf(state, "p1"), "p1")).toEqual({ type: "WINGS", use: true });
  });
  it("掷骰：留三个 3、留能量，重掷其余", () => {
    const state = buildState({ dice: ["3", "3", "3", "1", "energy", "2"], rolls: 1, rollsLeft: 2, p: { 1: { location: "city" } } });
    const decision = botDecision(viewOf(state, "p1"), "p1")!;
    expect(decision.command).toMatchObject({ type: "ROLL", keep: [0, 1, 2, 4] });
    expect(decision.reason).toContain("3 个 3");
  });
  it("掷骰：城里的怪兽只剩 2 血，留下两只爪", () => {
    const state = buildState({ dice: ["claw", "claw", "1", "2", "heart", "3"], rolls: 1, rollsLeft: 2, p: { 0: { life: 10 }, 1: { location: "city", life: 2 } } });
    const decision = botDecision(viewOf(state, "p1"), "p1")!;
    expect(decision.command).toMatchObject({ type: "ROLL", keep: [0, 1] });
    expect(decision.reason).toContain("打倒");
  });
  it("掷骰：在城里不留心", () => {
    const state = buildState({ dice: ["heart", "heart", "claw", "1", "2", "3"], rolls: 1, rollsLeft: 2, p: { 0: { location: "city", life: 4 } } });
    const command = botCommand(viewOf(state, "p1"), "p1")!;
    expect(command.type).toBe("ROLL");
    if (command.type === "ROLL") expect(command.keep).not.toContain(0);
  });
  it("掷骰：次数用完就结算，理由里说清楚得多少", () => {
    const state = buildState({ dice: ["3", "3", "3", "energy", "energy", "claw"], rolls: 3, rollsLeft: 0, p: { 0: { cards: ["stretchy"], energy: 0 }, 1: { location: "city" } } });
    const decision = botDecision(viewOf(state, "p1"), "p1")!;
    expect(decision.command).toEqual({ type: "RESOLVE" });
    expect(decision.reason).toContain("+3 分");
  });
  it("买牌：买了就到 20 分的卡一定买", () => {
    const state = buildState({ stage: "buy", market: ["corner-store", "giant-brain", "heal"], p: { 0: { vp: 19, energy: 3 } } });
    const decision = botDecision(viewOf(state, "p1"), "p1")!;
    expect(decision.command).toEqual({ type: "BUY", uid: state.market[0]!.uid });
    expect(decision.reason).toContain("20 分");
  });
  it("买牌：不买会把自己打死的卡", () => {
    const state = buildState({ stage: "buy", market: ["jet-fighters", "tanks", "national-guard"], p: { 0: { life: 2, energy: 10 } } });
    const command = botCommand(viewOf(state, "p1"), "p1")!;
    expect(command.type).not.toBe("BUY");
  });
  it("买牌：没有划算的就结束回合", () => {
    const state = buildState({ stage: "buy", market: ["energize", "mimic", "frenzy"], p: { 0: { energy: 2 } } });
    expect(botCommand(viewOf(state, "p1"), "p1")).toEqual({ type: "END_TURN" });
  });
  it("每个决定都带一句理由", () => {
    for (const name of ["start", "rolled", "lastRoll", "yield", "wings", "buy", "buyRich"] as const) {
      const state = scene(name);
      const actor = actorId(state);
      expect(botDecision(viewOf(state, actor), actor)!.reason.length).toBeGreaterThan(3);
    }
  });
});

describe("自对弈（每种人数 300 局）", () => {
  for (const players of [2, 3, 4, 5, 6]) {
    it(`${players} 人：每一步都合法、不死循环、单步够快`, () => {
      let worst = 0;
      let total = 0;
      let steps = 0;
      for (let game = 0; game < 300; game += 1) {
        let state = createGame(Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `人机${i + 1}` })), 9000 + game);
        let commands = 0;
        while (state.phase === "playing") {
          commands += 1;
          if (commands > MAX_COMMANDS) throw new Error(`种子 ${9000 + game} 超过 ${MAX_COMMANDS} 步`);
          const actor = actorId(state);
          const t0 = performance.now();
          const command = botCommand(redactGameForViewer(state, actor), actor);
          const ms = performance.now() - t0;
          worst = Math.max(worst, ms);
          total += ms;
          steps += 1;
          if (!command) throw new Error("人机没有给出动作");
          state = applyCommand(state, actor, command); // 不合法会抛错
        }
        expect(state.finalResult).toBeDefined();
      }
      expect(total / steps).toBeLessThan(50);
      expect(worst).toBeLessThan(300);
    }, 120_000);
  }
});
