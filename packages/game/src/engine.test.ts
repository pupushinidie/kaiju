import { describe, expect, it } from "vitest";
import { apply, applyCommand, clawTargets, createGame, legalActions, playerById, redactGameForViewer, scoreDice, timeoutTurn } from "./engine.js";
import { scriptedRng, createRng } from "./rng.js";
import { buildState } from "./scenes.js";
import { FACES, type Face, type GameCommand, type GameState } from "./types.js";
import { DECK_SIZE } from "./cards.js";

/** 用剧本骰子执行一条命令。 */
export function run(state: GameState, playerId: string, command: GameCommand, faces: readonly Face[] = []): GameState {
  return apply(state, playerId, command, scriptedRng(faces)).state;
}

/** 当前玩家结算这把骰子（骰子已经摆好，次数用完）。 */
function resolveWith(spec: Parameters<typeof buildState>[0], dice: Face[]): GameState {
  const state = buildState({ rolls: 3, rollsLeft: 0, ...spec, dice });
  const current = state.players[state.currentPlayer]!.id;
  return run(state, current, { type: "RESOLVE" });
}

const p = (state: GameState, id: string) => playerById(state, id);

describe("规则书#9 测试用例", () => {
  it("规则书#TC1 骰子面：一颗骰子六面各一种，掷 6 颗都落在这六种里", () => {
    expect([...FACES].sort()).toEqual(["1", "2", "3", "claw", "energy", "heart"].sort());
    const state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], 5);
    const id = state.players[state.currentPlayer]!.id;
    const rolled = apply(state, id, { type: "ROLL" }, createRng(9)).state;
    expect(rolled.turnState.dice).toHaveLength(6);
    for (const die of rolled.turnState.dice) expect(FACES).toContain(die.face);
    // 大量掷骰：每种面出现概率约 1/6
    const counts = new Map<string, number>();
    const rng = createRng(3);
    for (let i = 0; i < 6000; i += 1) {
      const face = FACES[rng.int(6)]!;
      counts.set(face, (counts.get(face) ?? 0) + 1);
    }
    for (const face of FACES) expect(counts.get(face)!).toBeGreaterThan(850);
  });

  it("规则书#TC2 三同花计分：3 个 3 → 3，4 个 3 → 4，5 个 2 → 4，2 个 3 → 0，1 个 1 → 0", () => {
    expect(scoreDice(["3", "3", "3", "1", "2", "claw"])).toBe(3);
    expect(scoreDice(["3", "3", "3", "3", "2", "claw"])).toBe(4);
    expect(scoreDice(["2", "2", "2", "2", "2", "claw"])).toBe(4);
    expect(scoreDice(["3", "3", "1", "2", "heart", "claw"])).toBe(0);
    expect(scoreDice(["1", "energy", "heart", "2", "heart", "claw"])).toBe(0);
    expect(scoreDice(["1", "1", "1", "2", "2", "2"])).toBe(3);
    const after = resolveWith({ p: { 1: { location: "city" } } }, ["3", "3", "3", "3", "2", "heart"]);
    expect(p(after, "p1").vp).toBe(4);
  });

  it("规则书#TC3 能量：2 颗闪电 +2 能量，跨回合保留", () => {
    const after = resolveWith({ p: { 1: { location: "city" } } }, ["energy", "energy", "1", "2", "3", "heart"]);
    expect(p(after, "p1").energy).toBe(2);
    const next = run(after, "p1", { type: "END_TURN" });
    expect(next.currentPlayer).toBe(1);
    expect(p(next, "p1").energy).toBe(2);
  });

  it("规则书#TC4 回血与上限：8 血 + 3 心 → 10；在城里结算心不回血", () => {
    const after = resolveWith({ p: { 0: { life: 8 }, 1: { location: "city" } } }, ["heart", "heart", "heart", "1", "2", "3"]);
    expect(p(after, "p1").life).toBe(10);
    const inCity = resolveWith({ p: { 0: { life: 6, location: "city" } } }, ["heart", "heart", "heart", "1", "2", "3"]);
    expect(p(inCity, "p1").life).toBe(6);
  });

  it("规则书#TC5 攻击落点（2–4 人）：城里的打城外所有人；城外的只打城里的", () => {
    const inside = resolveWith({ p: { 0: { location: "city" } } }, ["claw", "claw", "1", "2", "3", "energy"]);
    expect([p(inside, "p1").life, p(inside, "p2").life, p(inside, "p3").life, p(inside, "p4").life]).toEqual([10, 8, 8, 8]);
    const outside = resolveWith({ current: 1, p: { 0: { location: "city" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect([p(outside, "p1").life, p(outside, "p2").life, p(outside, "p3").life, p(outside, "p4").life]).toEqual([9, 10, 10, 10]);
    expect(clawTargets(outside, p(outside, "p2")).map((target) => target.id)).toEqual(["p1"]);
  });

  it("规则书#TC6（按勘误 3.1#1 改）城心空着：结算完必须进去 +1 分，不需要爪；空城时的爪不造成伤害", () => {
    const noClaw = resolveWith({}, ["1", "2", "3", "energy", "heart", "heart"]);
    expect(noClaw.city).toBe("p1");
    expect(p(noClaw, "p1").location).toBe("city");
    expect(p(noClaw, "p1").vp).toBe(1);
    const claws = resolveWith({}, ["claw", "claw", "claw", "energy", "heart", "1"]);
    expect(claws.city).toBe("p1");
    expect(claws.players.every((player) => player.life === 10)).toBe(true);
    expect(claws.stage).toBe("buy");
  });

  it("规则书#TC7 让位：乙在城心，甲 1 爪 → 乙 -1；让位 → 甲进城 +1 分；留下 → 甲不进", () => {
    const hit = resolveWith({ current: 0, p: { 1: { location: "city" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect(p(hit, "p2").life).toBe(9);
    expect(hit.stage).toBe("prompt");
    expect(hit.prompt).toMatchObject({ kind: "yield", player: "p2", attacker: "p1", spot: "city" });
    const yielded = run(hit, "p2", { type: "YIELD", yield: true });
    expect(yielded.city).toBe("p1");
    expect(p(yielded, "p2").location).toBeNull();
    expect(p(yielded, "p2").life).toBe(9);
    expect(p(yielded, "p1").vp).toBe(1);
    expect(yielded.stage).toBe("buy");
    const stayed = run(hit, "p2", { type: "YIELD", yield: false });
    expect(stayed.city).toBe("p2");
    expect(p(stayed, "p1").location).toBeNull();
    expect(p(stayed, "p1").vp).toBe(0);
  });

  it("规则书#TC8 城心收益：进城 +1 分；下一轮自己回合开始还在城里 +2 分", () => {
    let state = resolveWith({ players: 3 }, ["1", "2", "3", "energy", "heart", "heart"]);
    expect(p(state, "p1").vp).toBe(1);
    state = run(state, "p1", { type: "END_TURN" });
    for (const id of ["p2", "p3"]) {
      state = run(state, id, { type: "ROLL" }, ["1", "2", "3", "energy", "heart", "heart"]);
      state = run(state, id, { type: "RESOLVE" });
      state = run(state, id, { type: "END_TURN" });
    }
    expect(state.currentPlayer).toBe(0);
    expect(p(state, "p1").vp).toBe(3);
  });

  it("规则书#TC9 港湾（5–6 人）：城心=甲、港湾空，乙爪 → 甲先 -1，乙进港湾；甲让位则乙进城心、港湾空着；城心港湾互不打", () => {
    const hit = resolveWith({ players: 5, current: 1, p: { 0: { location: "city" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect(p(hit, "p1").life).toBe(9);
    const stay = run(hit, "p1", { type: "YIELD", yield: false });
    expect(stay.city).toBe("p1");
    expect(stay.bay).toBe("p2");
    expect(p(stay, "p2").vp).toBe(1);
    const yielded = run(hit, "p1", { type: "YIELD", yield: true });
    expect(yielded.city).toBe("p2");
    expect(yielded.bay).toBeNull();
    // 城心打城外，不打港湾
    const fromCity = resolveWith({ players: 5, current: 0, p: { 0: { location: "city" }, 1: { location: "bay" } } }, ["claw", "claw", "1", "2", "3", "energy"]);
    expect(p(fromCity, "p2").life).toBe(10);
    expect([p(fromCity, "p3").life, p(fromCity, "p4").life, p(fromCity, "p5").life]).toEqual([8, 8, 8]);
    // 城外打城心 + 港湾，先问城心再问港湾
    const both = resolveWith({ players: 5, current: 2, p: { 0: { location: "city" }, 1: { location: "bay" } } }, ["claw", "claw", "1", "2", "3", "energy"]);
    expect([p(both, "p1").life, p(both, "p2").life]).toEqual([8, 8]);
    expect(both.prompt).toMatchObject({ kind: "yield", player: "p1" });
    const next = run(both, "p1", { type: "YIELD", yield: false });
    expect(next.prompt).toMatchObject({ kind: "yield", player: "p2", spot: "bay" });
    const bayYield = run(next, "p2", { type: "YIELD", yield: true });
    expect(bayYield.bay).toBe("p3");
    expect(bayYield.city).toBe("p1");
  });

  it("规则书#TC10（按勘误 3.1#2 改）5 人局降到 4 只：港湾里的怪兽在城心空着时移进城心，否则离开", () => {
    // 城心有人：港湾的离开
    const a = resolveWith({ players: 5, current: 0, p: { 0: { location: "city" }, 2: { location: "bay" }, 3: { life: 1 } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect(p(a, "p4").alive).toBe(false);
    expect(a.bayOpen).toBe(false);
    expect(a.bay).toBeNull();
    expect(p(a, "p3").location).toBeNull();
    expect(a.city).toBe("p1");
    // 城心的倒了：港湾的移进城心
    const b = resolveWith({ players: 5, current: 3, p: { 0: { location: "city", life: 1 }, 2: { location: "bay" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect(p(b, "p1").alive).toBe(false);
    expect(b.city).toBe("p3");
    expect(b.bay).toBeNull();
    expect(b.bayOpen).toBe(false);
    // 当前玩家（攻击者）没进城（城心被港湾移来的占了）
    expect(p(b, "p4").location).toBeNull();
  });

  it("规则书#TC11 买牌和扫牌：10 能量扫牌 → 8，买 3 费 → 5，空位从牌堆顶补，位置不变", () => {
    let state = buildState({ stage: "buy", p: { 0: { energy: 10 } }, deckTop: ["skyscraper", "heal", "frenzy", "corner-store"] });
    state = run(state, "p1", { type: "SWEEP" });
    expect(p(state, "p1").energy).toBe(8);
    expect(state.market.map((card) => card!.id)).toEqual(["skyscraper", "heal", "frenzy"]);
    state = run(state, "p1", { type: "BUY", uid: state.market[1]!.uid });
    expect(p(state, "p1").energy).toBe(5);
    expect(state.market.map((card) => card!.id)).toEqual(["skyscraper", "corner-store", "frenzy"]);
    expect(state.discard.map((card) => card.id)).toContain("heal");
  });

  it("规则书#TC12 一次性卡 vs 保留卡：摩天楼 +4 分并弃掉；更巨大 +2 血、留在面前", () => {
    let state = buildState({ stage: "buy", market: ["skyscraper", "even-bigger", "heal"], p: { 0: { energy: 10 } } });
    state = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(p(state, "p1").vp).toBe(4);
    expect(state.discard.at(-1)!.id).toBe("skyscraper");
    state = run(state, "p1", { type: "BUY", uid: state.market[1]!.uid });
    expect(p(state, "p1").life).toBe(12);
    expect(p(state, "p1").cards.map((card) => card.id)).toEqual(["even-bigger"]);
  });

  it("规则书#TC13 胜利：回合结束时 20 分获胜；同回合被打到 0 就不算", () => {
    const win = run(buildState({ stage: "buy", p: { 0: { vp: 20 } } }), "p1", { type: "END_TURN" });
    expect(win.phase).toBe("finished");
    expect(win.finalResult).toEqual({ winners: ["p1"], reason: "vp" });
    // 买战斗机 +5 分到 20，同时受 4 伤害倒下
    const state = buildState({ stage: "buy", market: ["jet-fighters", "heal", "tanks"], p: { 0: { vp: 15, life: 4, energy: 5 } } });
    const dead = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(p(dead, "p1").alive).toBe(false);
    expect(dead.phase).toBe("playing");
    expect(dead.currentPlayer).toBe(1);
  });

  it("规则书#TC14 全员同回合倒下 → 没有赢家", () => {
    const state = buildState({ players: 2, stage: "buy", market: ["high-altitude-bombing", "heal", "tanks"], p: { 0: { life: 3, energy: 4 }, 1: { life: 2 } } });
    const end = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(end.phase).toBe("finished");
    expect(end.finalResult).toEqual({ winners: [], reason: "allDead" });
  });

  it("规则书#TC15 2 人局：进城 +1 能量不加分，回合开始在城里 +1 能量", () => {
    let state = resolveWith({ players: 2 }, ["1", "2", "3", "heart", "heart", "heart"]);
    expect(p(state, "p1").vp).toBe(0);
    expect(p(state, "p1").energy).toBe(1);
    state = run(state, "p1", { type: "END_TURN" });
    state = run(state, "p2", { type: "ROLL" }, ["1", "2", "3", "heart", "heart", "heart"]);
    state = run(state, "p2", { type: "RESOLVE" });
    state = run(state, "p2", { type: "END_TURN" });
    expect(p(state, "p1").vp).toBe(0);
    expect(p(state, "p1").energy).toBe(2);
  });

  it("规则书#TC16 校验：不是自己回合、能量不够、次数用完、不是被问的人都拒绝", () => {
    const state = buildState({ stage: "buy", market: ["skyscraper", "heal", "tanks"], p: { 0: { energy: 2 } } });
    for (const command of [{ type: "BUY", uid: state.market[0]!.uid }, { type: "SWEEP" }, { type: "END_TURN" }, { type: "ROLL" }] as GameCommand[]) {
      expect(() => run(state, "p2", command)).toThrow("还没轮到你");
    }
    expect(() => run(state, "p1", { type: "BUY", uid: state.market[0]!.uid })).toThrow("能量不够");
    const noRolls = buildState({ dice: ["1", "1", "2", "2", "3", "claw"], rolls: 3, rollsLeft: 0, p: { 0: { cards: ["stretchy"], energy: 2 } } });
    expect(() => run(noRolls, "p1", { type: "ROLL", keep: [0] })).toThrow("没有重掷次数");
    const yieldPrompt = resolveWith({ current: 0, p: { 1: { location: "city" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect(() => run(yieldPrompt, "p3", { type: "YIELD", yield: true })).toThrow("还没轮到你");
    expect(() => run(yieldPrompt, "p1", { type: "YIELD", yield: true })).toThrow("还没轮到你");
  });
});

describe("规则书第 3 节 开局", () => {
  it("每只怪兽 10 血 0 分 0 能量；城心空着；3 张公开牌；5–6 人才开港湾；怪兽不重复", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const state = createGame(Array.from({ length: n }, (_, i) => ({ id: `x${i}`, name: `玩家${i}` })), 100 + n);
      expect(state.players.every((player) => player.life === 10 && player.vp === 0 && player.energy === 0 && player.location === null)).toBe(true);
      expect(state.city).toBeNull();
      expect(state.market.filter(Boolean)).toHaveLength(3);
      expect(state.deck).toHaveLength(DECK_SIZE - 3);
      expect(state.bayOpen).toBe(n >= 5);
      expect(new Set(state.players.map((player) => player.monster)).size).toBe(n);
      expect(state.turnState.dice).toHaveLength(6);
      expect(state.turnState.rollsLeft).toBe(3);
    }
  });

  it("选了的怪兽照选，撞了或没选的随机分", () => {
    const state = createGame([
      { id: "a", name: "甲", monster: "crab" },
      { id: "b", name: "乙", monster: "crab" },
      { id: "c", name: "丙" },
    ], 9);
    expect(state.players[0]!.monster).toBe("crab");
    expect(state.players[1]!.monster).not.toBe("crab");
    expect(new Set(state.players.map((player) => player.monster)).size).toBe(3);
  });
});

describe("规则书第 4 节 回合流程", () => {
  it("4 掷骰：第一次全掷，之后留下的不动、其余重掷，最多 3 次（含第一次），用完自动结算", () => {
    let state = buildState({});
    state = run(state, "p1", { type: "ROLL" }, ["3", "3", "1", "2", "energy", "claw"]);
    expect(state.turnState.rollsLeft).toBe(2);
    state = run(state, "p1", { type: "ROLL", keep: [0, 1] }, ["3", "heart", "heart", "1"]);
    expect(state.turnState.dice.map((die) => die.face)).toEqual(["3", "3", "3", "heart", "heart", "1"]);
    // 留下的也能拿起来重掷
    state = run(state, "p1", { type: "ROLL", keep: [1, 2] }, ["3", "3", "3", "energy"]);
    expect(state.turnState.dice.map((die) => die.face)).toEqual(["3", "3", "3", "3", "3", "energy"]);
    expect(state.turnState.resolved).toBe(true);
    expect(p(state, "p1").vp).toBe(5 + 1); // 五个 3 = 5 分，进城 +1
    expect(state.stage).toBe("buy");
  });

  it("4 第一次掷之前不能结算；留下全部骰子的重掷不允许", () => {
    const state = buildState({});
    expect(() => run(state, "p1", { type: "RESOLVE" })).toThrow("先掷骰子");
    const rolled = run(state, "p1", { type: "ROLL" }, ["3", "3", "1", "2", "energy", "claw"]);
    expect(() => run(rolled, "p1", { type: "ROLL", keep: [0, 1, 2, 3, 4, 5] })).toThrow("至少要重掷一颗");
  });

  it("4.1 结算顺序：数字 → 能量 → 心 → 爪，同一把骰子一起算", () => {
    const after = resolveWith({ p: { 0: { life: 7 }, 1: { location: "city" } } }, ["2", "2", "2", "energy", "heart", "claw"]);
    expect(p(after, "p1")).toMatchObject({ vp: 2, energy: 1, life: 8 });
    expect(p(after, "p2").life).toBe(9);
    const types = after.events.map((event) => event.type);
    expect(types.indexOf("Vp")).toBeLessThan(types.indexOf("Energy"));
    expect(types.indexOf("Energy")).toBeLessThan(types.indexOf("Healed"));
    expect(types.indexOf("Healed")).toBeLessThan(types.indexOf("Attack"));
  });

  it("4.3 在城里被爪打死：攻击者进城（+1 分）", () => {
    const after = resolveWith({ current: 1, p: { 0: { location: "city", life: 2 } } }, ["claw", "claw", "1", "2", "3", "energy"]);
    expect(p(after, "p1").alive).toBe(false);
    expect(after.city).toBe("p2");
    expect(p(after, "p2").vp).toBe(1);
  });

  it("4.3 在城里被卡牌打死：城心空着，下一个结算完骰子的怪兽进去", () => {
    const state = buildState({ stage: "buy", market: ["fire-blast", "heal", "tanks"], p: { 0: { energy: 3 }, 1: { location: "city", life: 2 } } });
    let after = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(p(after, "p2").alive).toBe(false);
    expect(after.city).toBeNull();
    expect(p(after, "p1").location).toBeNull();
    after = run(after, "p1", { type: "END_TURN" });
    expect(after.currentPlayer).toBe(2);
    after = run(after, "p3", { type: "ROLL" }, ["1", "2", "3", "energy", "heart", "heart"]);
    after = run(after, "p3", { type: "RESOLVE" });
    expect(after.city).toBe("p3");
  });

  it("4.3 卡牌伤害不能让位（勘误 3.2）", () => {
    const state = buildState({ stage: "buy", market: ["fire-blast", "heal", "tanks"], p: { 0: { energy: 3 }, 1: { location: "city" } } });
    const after = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(p(after, "p2").life).toBe(8);
    expect(after.prompt).toBeUndefined();
    expect(after.stage).toBe("buy");
  });

  it("4.3 盔甲全挡了（没掉血）不能让位", () => {
    const after = resolveWith({ current: 0, p: { 1: { location: "city", cards: ["armor-plating"] } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    expect(p(after, "p2").life).toBe(10);
    expect(after.prompt).toBeUndefined();
  });

  it("4.4 港湾：城心有人、港湾空着，没掷爪的城外怪兽也要进港湾", () => {
    const after = resolveWith({ players: 6, current: 2, p: { 0: { location: "city" } } }, ["1", "2", "3", "energy", "heart", "heart"]);
    expect(after.bay).toBe("p3");
    expect(p(after, "p3").vp).toBe(1);
  });

  it("4.4 城心、港湾都让位：攻击者进城心，港湾空着", () => {
    let state = resolveWith({ players: 6, current: 2, p: { 0: { location: "city" }, 1: { location: "bay" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    state = run(state, "p1", { type: "YIELD", yield: true });
    state = run(state, "p2", { type: "YIELD", yield: true });
    expect(state.city).toBe("p3");
    expect(state.bay).toBeNull();
  });

  it("回合结束交给下一只活着的怪兽，跳过出局的", () => {
    const state = buildState({ stage: "buy", p: { 1: { alive: false } } });
    const next = run(state, "p1", { type: "END_TURN" });
    expect(next.currentPlayer).toBe(2);
    expect(next.turn).toBe(2);
  });
});

describe("规则书第 5–6 节 计分和胜负", () => {
  it("出局的怪兽卡和能量全弃", () => {
    const after = resolveWith({ current: 1, p: { 0: { location: "city", life: 1, energy: 5, cards: ["armor-plating", "solar-powered"] } } }, ["claw", "claw", "1", "2", "3", "energy"]);
    expect(p(after, "p1").alive).toBe(false);
    expect(p(after, "p1").energy).toBe(0);
    expect(p(after, "p1").cards).toEqual([]);
    expect(after.discard.map((card) => card.id)).toEqual(expect.arrayContaining(["armor-plating", "solar-powered"]));
  });

  it("只剩最后一只立刻获胜（不用 20 分）", () => {
    const after = resolveWith({ players: 2, current: 0, p: { 0: { location: "city" }, 1: { life: 2 } } }, ["claw", "claw", "1", "2", "3", "energy"]);
    expect(after.phase).toBe("finished");
    expect(after.finalResult).toEqual({ winners: ["p1"], reason: "lastStanding" });
  });

  it("多只同时到 20 分都活着：并列获胜（勘误 3.2）", () => {
    const state = buildState({ players: 3, stage: "buy", p: { 0: { vp: 20 }, 1: { vp: 22 }, 2: { vp: 19 } } });
    const end = run(state, "p1", { type: "END_TURN" });
    expect(end.finalResult).toEqual({ winners: ["p1", "p2"], reason: "vp" });
  });

  it("别人回合里到 20 分（食尸者）：这回合结束时判胜", () => {
    const state = buildState({ players: 3, current: 0, p: { 0: { location: "city" }, 1: { life: 1 }, 2: { vp: 18, cards: ["eater-of-the-dead"] } } });
    let after = run(state, "p1", { type: "ROLL" }, ["claw", "1", "2", "energy", "heart", "heart"]);
    after = run(after, "p1", { type: "RESOLVE" });
    expect(p(after, "p3").vp).toBe(21);
    expect(after.phase).toBe("playing");
    after = run(after, "p1", { type: "END_TURN" });
    expect(after.finalResult).toEqual({ winners: ["p3"], reason: "vp" });
  });

  it("分数可以超过 20，生命不超过上限", () => {
    const after = resolveWith({ p: { 0: { vp: 19, life: 9 }, 1: { location: "city" } } }, ["3", "3", "3", "3", "heart", "heart"]);
    expect(p(after, "p1").vp).toBe(23);
    expect(p(after, "p1").life).toBe(10);
  });
});

describe("规则书第 8.4 节 超时", () => {
  it("掷骰超时：还没掷就掷一次，不重掷直接结算", () => {
    const state = buildState({});
    const after = timeoutTurn({ ...state, rngState: 42 });
    expect(after.turnState.rolls).toBe(1);
    expect(after.turnState.resolved).toBe(true);
    expect(after.events[0]).toMatchObject({ type: "TurnTimedOut", player: "p1", stage: "roll" });
  });

  it("掷过之后超时：保留当前骰子直接结算", () => {
    const state = buildState({ dice: ["3", "3", "3", "1", "1", "energy"], rolls: 1, rollsLeft: 2, p: { 1: { location: "city" } } });
    const after = timeoutTurn(state);
    expect(p(after, "p1").vp).toBe(3);
    expect(after.stage).toBe("buy");
  });

  it("让位超时：留下", () => {
    const hit = resolveWith({ current: 0, p: { 1: { location: "city" } } }, ["claw", "1", "2", "3", "energy", "heart"]);
    const after = timeoutTurn(hit);
    expect(after.city).toBe("p2");
    expect(after.events[0]).toMatchObject({ type: "TurnTimedOut", player: "p2", stage: "yield" });
    expect(after.stage).toBe("buy");
    expect(after.currentPlayer).toBe(0);
  });

  it("买牌超时：直接结束回合", () => {
    const state = buildState({ stage: "buy", p: { 0: { energy: 9 } } });
    const after = timeoutTurn(state);
    expect(after.currentPlayer).toBe(1);
    expect(p(after, "p1").energy).toBe(9);
  });

  it("双翼超时：不用", () => {
    const hit = resolveWith({ current: 0, p: { 1: { location: "city", energy: 3, cards: ["wings"] } } }, ["claw", "claw", "2", "3", "energy", "heart"]);
    expect(hit.prompt).toMatchObject({ kind: "wings", player: "p2" });
    const after = timeoutTurn(hit);
    expect(p(after, "p2").life).toBe(8);
    expect(p(after, "p2").energy).toBe(3);
  });
});

describe("计时 key（step）", () => {
  it("快速治疗是轮外操作，不改 step；别的命令改 step", () => {
    const state = buildState({ p: { 2: { cards: ["rapid-healing"], energy: 4, life: 5 } } });
    const healed = run(state, "p3", { type: "RAPID_HEAL" });
    expect(healed.step).toBe(state.step);
    expect(healed.version).toBe(state.version + 1);
    expect(p(healed, "p3").life).toBe(6);
    const rolled = run(state, "p1", { type: "ROLL" }, ["1", "1", "1", "1", "1", "1"]);
    expect(rolled.step).toBe(state.step + 1);
  });
});

describe("隐藏信息（redactGameForViewer）", () => {
  it("牌堆顺序、种子、随机数状态、动作序列都不下发；每个视角和观战都一样", () => {
    let state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }], 77);
    state = applyCommand(state, state.players[state.currentPlayer]!.id, { type: "ROLL" });
    for (const viewer of ["a", "b", "c", ""]) {
      const view = redactGameForViewer(state, viewer);
      expect(view.deck).toEqual([]);
      expect(view.deckCount).toBe(state.deck.length);
      expect(view.seed).toBeUndefined();
      expect(view.rngState).toBeUndefined();
      expect(view.log).toBeUndefined();
      expect(view.peek).toBeUndefined();
      const text = JSON.stringify(view);
      for (const card of state.deck) expect(text).not.toContain(`"${card.uid}"`);
    }
  });

  it("实验室出品：只有主人在自己买牌时能看到牌堆顶一张", () => {
    const state = buildState({ stage: "buy", deckTop: ["frenzy"], p: { 0: { cards: ["made-in-a-lab"], energy: 9 } } });
    expect(redactGameForViewer(state, "p1").peek?.id).toBe("frenzy");
    expect(redactGameForViewer(state, "p2").peek).toBeUndefined();
    expect(redactGameForViewer(state, "").peek).toBeUndefined();
    const rolling = buildState({ deckTop: ["frenzy"], p: { 0: { cards: ["made-in-a-lab"] } } });
    expect(redactGameForViewer(rolling, "p1").peek).toBeUndefined();
    // 能按看到的那张买
    const view = redactGameForViewer(state, "p1");
    const bought = run(state, "p1", { type: "BUY", uid: view.peek!.uid });
    expect(p(bought, "p1").vp).toBe(0);
    expect(bought.extraTurns).toEqual(["frenzy"]);
  });

  it("legalActions 对玩家视角也能用（人机只拿得到 redact 后的状态）", () => {
    const state = buildState({ stage: "buy", p: { 0: { energy: 9 } } });
    const view = redactGameForViewer(state, "p1");
    const actions = legalActions(view, "p1");
    expect(actions.some((action) => action.type === "END_TURN")).toBe(true);
    expect(actions.some((action) => action.type === "BUY")).toBe(true);
  });
});

describe("apply 不改输入", () => {
  it("输入状态深拷贝前后一样", () => {
    const state = buildState({ dice: ["claw", "claw", "1", "2", "3", "energy"], rolls: 3, rollsLeft: 0, p: { 1: { location: "city" } } });
    const before = JSON.stringify(state);
    run(state, "p1", { type: "RESOLVE" });
    expect(JSON.stringify(state)).toBe(before);
  });
});
