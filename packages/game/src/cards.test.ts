import { describe, expect, it } from "vitest";
import { CARD_LIST, CARDS, DECK_SIZE, fullDeck, type CardId } from "./cards.js";
import { apply, playerById } from "./engine.js";
import { scriptedRng } from "./rng.js";
import { buildState, type StateSpec } from "./scenes.js";
import type { Face, GameCommand, GameState } from "./types.js";

function run(state: GameState, playerId: string, command: GameCommand, faces: readonly Face[] = []): GameState {
  return apply(state, playerId, command, scriptedRng(faces)).state;
}
const p = (state: GameState, id: string) => playerById(state, id);

/** p1 在买牌阶段买 card（放在公开牌第一格）。 */
function buy(card: CardId, spec: StateSpec = {}, extra: Partial<Extract<GameCommand, { type: "BUY" }>> = {}): GameState {
  const state = buildState({ stage: "buy", market: [card, "corner-store", "heal"].map((id, i) => (i > 0 && id === card ? "commuter-train" : id)) as CardId[], ...spec, p: { ...spec.p, 0: { energy: 20, ...spec.p?.[0] } } });
  return run(state, "p1", { type: "BUY", uid: state.market[0]!.uid, ...extra });
}

/** 当前玩家结算一把摆好的骰子。 */
function resolve(spec: StateSpec, dice: Face[], faces: Face[] = []): GameState {
  const state = buildState({ rolls: 3, rollsLeft: 0, ...spec, dice });
  return run(state, state.players[state.currentPlayer]!.id, { type: "RESOLVE" }, faces);
}

/** 一路按「全 1 2 3 无效骰」把回合交到 seat 号玩家（下一个回合开始）。 */
function endTurnOf(state: GameState, id: string): GameState {
  return run(state, id, { type: "END_TURN" });
}

describe("卡表", () => {
  it("63 张（61 种）：一次性 18 张、保留 45 张；去掉了治疗射线、投机者、读心探针", () => {
    expect(CARD_LIST).toHaveLength(61);
    expect(fullDeck()).toHaveLength(DECK_SIZE);
    expect(CARD_LIST.filter((card) => card.kind === "discard").reduce((n, card) => n + card.copies, 0)).toBe(18);
    expect(CARD_LIST.filter((card) => card.kind === "keep").reduce((n, card) => n + card.copies, 0)).toBe(45);
    const ids = CARD_LIST.map((card) => card.id as string);
    for (const removed of ["healing-ray", "opportunist", "psychic-probe"]) expect(ids).not.toContain(removed);
    expect(CARDS["evacuation-orders"].copies).toBe(2);
    expect(CARDS["extra-head"].copies).toBe(2);
  });
});

describe("一次性卡（逐张）", () => {
  it("#1 公寓大楼 5 费 +3 分", () => {
    const s = buy("apartment-building");
    expect(p(s, "p1")).toMatchObject({ vp: 3, energy: 15 });
  });
  it("#2 通勤列车 4 费 +2 分", () => {
    expect(p(buy("commuter-train"), "p1")).toMatchObject({ vp: 2, energy: 16 });
  });
  it("#3 街角小店 3 费 +1 分", () => {
    const state = buildState({ stage: "buy", market: ["corner-store", "heal", "tanks"], p: { 0: { energy: 3 } } });
    const s = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(p(s, "p1")).toMatchObject({ vp: 1, energy: 0 });
  });
  it("#4 高空坠落：+2 分并占领城心（原来的被挤出去，不吃伤害）；进城本身 +1", () => {
    const s = buy("drop-from-high-altitude", { p: { 1: { location: "city" } } });
    expect(s.city).toBe("p1");
    expect(p(s, "p2").location).toBeNull();
    expect(p(s, "p2").life).toBe(10);
    expect(p(s, "p1").vp).toBe(3);
    // 已经在城心：只 +2 分
    const inCity = buy("drop-from-high-altitude", { p: { 0: { location: "city" } } });
    expect(p(inCity, "p1").vp).toBe(2);
    // 在港湾：换到城心，港湾空出来
    const fromBay = buy("drop-from-high-altitude", { players: 5, p: { 0: { location: "bay" }, 1: { location: "city" } } });
    expect(fromBay.city).toBe("p1");
    expect(fromBay.bay).toBeNull();
  });
  it("#5 充能 8 费 +9 能量", () => {
    const state = buildState({ stage: "buy", market: ["energize", "heal", "tanks"], p: { 0: { energy: 8 } } });
    expect(p(run(state, "p1", { type: "BUY", uid: state.market[0]!.uid }), "p1").energy).toBe(9);
  });
  it("#6 疏散令：其他怪兽各 -5 分（不低于 0）", () => {
    const s = buy("evacuation-orders", { p: { 0: { vp: 4 }, 1: { vp: 7 }, 2: { vp: 3 } } });
    expect([p(s, "p1").vp, p(s, "p2").vp, p(s, "p3").vp, p(s, "p4").vp]).toEqual([4, 2, 0, 0]);
  });
  it("#7 火焰冲击：其他怪兽各受 2 伤害", () => {
    const s = buy("fire-blast");
    expect(s.players.map((player) => player.life)).toEqual([10, 8, 8, 8]);
  });
  it("#8 狂暴：这回合结束后再来一个回合（只多一回合）", () => {
    let s = buy("frenzy");
    s = run(s, "p1", { type: "END_TURN" });
    expect(s.currentPlayer).toBe(0);
    expect(s.events.find((event) => event.type === "TurnStarted")).toMatchObject({ player: "p1", extra: "frenzy" });
    s = run(s, "p1", { type: "ROLL" }, ["1", "2", "3", "energy", "heart", "heart"]);
    s = run(s, "p1", { type: "RESOLVE" });
    s = run(s, "p1", { type: "END_TURN" });
    expect(s.currentPlayer).toBe(1);
  });
  it("#9 瓦斯精炼厂：+2 分，其他怪兽各受 3 伤害（不算攻击，不能让位）", () => {
    const s = buy("gas-refinery", { p: { 1: { location: "city" } } });
    expect(p(s, "p1").vp).toBe(2);
    expect(s.players.map((player) => player.life)).toEqual([10, 7, 7, 7]);
    expect(s.prompt).toBeUndefined();
  });
  it("#10 治疗：回 2 血", () => {
    expect(p(buy("heal", { p: { 0: { life: 5 } } }), "p1").life).toBe(7);
  });
  it("#11 高空轰炸：所有怪兽（包括自己）各受 3 伤害", () => {
    expect(buy("high-altitude-bombing").players.map((player) => player.life)).toEqual([7, 7, 7, 7]);
  });
  it("#12 战斗机：+5 分，自己受 4 伤害", () => {
    expect(p(buy("jet-fighters"), "p1")).toMatchObject({ vp: 5, life: 6 });
  });
  it("#13 国民警卫队：+2 分，自己受 2 伤害", () => {
    expect(p(buy("national-guard"), "p1")).toMatchObject({ vp: 2, life: 8 });
  });
  it("#14 核电站：+2 分，回 3 血", () => {
    expect(p(buy("nuclear-power-plant", { p: { 0: { life: 5 } } }), "p1")).toMatchObject({ vp: 2, life: 8 });
  });
  it("#15 摩天楼：+4 分", () => {
    expect(p(buy("skyscraper"), "p1").vp).toBe(4);
  });
  it("#16 坦克：+4 分，自己受 3 伤害", () => {
    expect(p(buy("tanks"), "p1")).toMatchObject({ vp: 4, life: 7 });
  });
  it("#17 大风暴：+2 分，其他怪兽每有 2 能量丢 1", () => {
    const s = buy("vast-storm", { p: { 1: { energy: 5 }, 2: { energy: 1 }, 3: { energy: 8 } } });
    expect(p(s, "p1").vp).toBe(2);
    expect([p(s, "p2").energy, p(s, "p3").energy, p(s, "p4").energy]).toEqual([3, 1, 4]);
  });
});

describe("保留卡（逐张）", () => {
  it("#18 酸液攻击：没掷出爪也打 1，算攻击，能让位", () => {
    const s = resolve({ p: { 0: { cards: ["acid-attack"] }, 1: { location: "city" } } }, ["1", "2", "3", "energy", "heart", "heart"]);
    expect(p(s, "p2").life).toBe(9);
    expect(s.prompt).toMatchObject({ kind: "yield", player: "p2" });
    const withClaws = resolve({ p: { 0: { cards: ["acid-attack"] }, 1: { location: "city" } } }, ["claw", "claw", "3", "energy", "heart", "heart"]);
    expect(p(withClaws, "p2").life).toBe(7);
  });
  it("#19 外星新陈代谢：买卡便宜 1，扫牌不打折", () => {
    const s = buy("apartment-building", { p: { 0: { cards: ["alien-metabolism"], energy: 4 } } });
    expect(p(s, "p1")).toMatchObject({ vp: 3, energy: 0 });
    const state = buildState({ stage: "buy", p: { 0: { cards: ["alien-metabolism"], energy: 2 } } });
    expect(p(run(state, "p1", { type: "SWEEP" }), "p1").energy).toBe(0);
  });
  it("#20 头号怪兽：攻击时 +1 分；空城时的爪不算攻击", () => {
    const s = resolve({ p: { 0: { cards: ["alpha-monster"] }, 1: { location: "city" } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(s, "p1").vp).toBe(1);
    const empty = resolve({ p: { 0: { cards: ["alpha-monster"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(empty, "p1").vp).toBe(1); // 只有进城的 1 分
  });
  it("#21 装甲板：一次只受 1 点时免掉；2 点照扣", () => {
    const one = resolve({ current: 1, p: { 0: { location: "city", cards: ["armor-plating"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(one, "p1").life).toBe(10);
    const two = resolve({ current: 1, p: { 0: { location: "city", cards: ["armor-plating"] } } }, ["claw", "claw", "2", "energy", "heart", "heart"]);
    expect(p(two, "p1").life).toBe(8);
  });
  it("#22 背景住户：次数用完后还能免费重掷 3", () => {
    let s = buildState({ dice: ["3", "3", "1", "claw", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { cards: ["background-dweller"] }, 1: { location: "city" } } });
    s = run(s, "p1", { type: "ROLL", keep: [2, 3, 4, 5] }, ["1", "1"]);
    expect(s.turnState.dice.map((die) => die.face)).toEqual(["1", "1", "1", "claw", "energy", "heart"]);
    expect(s.events.find((event) => event.type === "Rolled")).toMatchObject({ use: "dweller" });
    // 没有 3 可掷时自动结算
    expect(s.turnState.resolved).toBe(true);
    // 重掷非 3 的骰子不行
    const t = buildState({ dice: ["3", "3", "1", "claw", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { cards: ["background-dweller"] } } });
    expect(() => run(t, "p1", { type: "ROLL", keep: [0, 1, 3, 4, 5] })).toThrow("没有重掷次数");
  });
  it("#23 钻地：在城里攻击多 1；让位时接替的怪兽受 1 伤害", () => {
    const s = resolve({ p: { 0: { location: "city", cards: ["burrowing"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect([p(s, "p2").life, p(s, "p3").life]).toEqual([8, 8]);
    let y = resolve({ current: 1, p: { 0: { location: "city", cards: ["burrowing"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    y = run(y, "p1", { type: "YIELD", yield: true });
    expect(y.city).toBe("p2");
    expect(p(y, "p2").life).toBe(9);
  });
  it("#24 伪装：每点伤害掷一颗骰，掷出心免 1 点", () => {
    // 2 点伤害，伪装掷出 心、爪 → 只扣 1
    const s = resolve({ current: 1, p: { 0: { location: "city", cards: ["camouflage"] } } }, ["claw", "claw", "1", "energy", "heart", "heart"], ["heart", "claw"]);
    expect(p(s, "p1").life).toBe(9);
    expect(s.events.find((event) => event.type === "Damaged")).toMatchObject({ amount: 1, blocked: 1, blockedBy: "camouflage" });
  });
  it("#25 彻底破坏：六种面都有 +9 分", () => {
    const s = resolve({ p: { 0: { cards: ["complete-destruction"] }, 1: { location: "city" } } }, ["1", "2", "3", "energy", "heart", "claw"]);
    expect(p(s, "p1").vp).toBe(9);
  });
  it("#26 专属新闻组：之后每买一张卡 +1 分（买它自己那次不算）", () => {
    let state = buildState({ stage: "buy", market: ["dedicated-news-team", "heal", "corner-store"], p: { 0: { energy: 20, life: 5 } } });
    state = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid });
    expect(p(state, "p1").vp).toBe(0);
    state = run(state, "p1", { type: "BUY", uid: state.market[1]!.uid });
    expect(p(state, "p1").vp).toBe(1);
  });
  it("#27 食尸者：每有一只怪兽生命到 0，+3 分", () => {
    const s = resolve({ p: { 0: { location: "city" }, 1: { life: 1 }, 2: { life: 1 }, 3: { cards: ["eater-of-the-dead"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(s, "p4").vp).toBe(6);
  });
  it("#28 能量囤积者：回合结束时每 6 能量 +1 分", () => {
    const s = endTurnOf(buildState({ stage: "buy", p: { 0: { energy: 13, cards: ["energy-hoarder"] } } }), "p1");
    expect(p(s, "p1").vp).toBe(2);
  });
  it("#29 更巨大：上限 12，买时回 2；卖掉（变形）后上限回 10，多的血扣掉", () => {
    let s = buy("even-bigger", { p: { 0: { cards: ["metamorph"] } } });
    expect(p(s, "p1").life).toBe(12);
    s = run(s, "p1", { type: "SELL", uid: p(s, "p1").cards.find((card) => card.id === "even-bigger")!.uid });
    expect(p(s, "p1").life).toBe(10);
  });
  it("#30 额外脑袋：多掷 1 颗（两张多 2 颗）", () => {
    const one = endTurnOf(buildState({ stage: "buy", current: 3, p: { 0: { cards: ["extra-head"] } } }), "p4");
    expect(one.turnState.dice).toHaveLength(7);
    expect(one.turnState.dice[6]!.green).toBe(true);
    const two = endTurnOf(buildState({ stage: "buy", current: 3, p: { 0: { cards: ["extra-head", "extra-head"] } } }), "p4");
    expect(two.turnState.dice).toHaveLength(8);
  });
  it("#31 喷火：造成伤害时左右邻座各多 1；只剩 2 只时只多 1", () => {
    // p1 在城里 1 爪：p2、p4 是邻座各 2，p3 是 1
    const s = resolve({ p: { 0: { location: "city", cards: ["fire-breathing"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect([p(s, "p2").life, p(s, "p3").life, p(s, "p4").life]).toEqual([8, 9, 8]);
    const two = resolve({ players: 2, p: { 0: { location: "city", cards: ["fire-breathing"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(two, "p2").life).toBe(8);
    // 卡牌伤害也算：火焰冲击打 2，邻座 3
    const blast = buy("fire-blast", { p: { 0: { cards: ["fire-breathing"] } } });
    expect(blast.players.map((player) => player.life)).toEqual([10, 7, 8, 7]);
  });
  it("#32 冻结时间：计分三个 1 → 再来一回合，少掷 1 颗；可以连续", () => {
    let s = resolve({ p: { 0: { cards: ["freeze-time"] }, 1: { location: "city" } } }, ["1", "1", "1", "energy", "heart", "heart"]);
    s = run(s, "p1", { type: "END_TURN" });
    expect(s.currentPlayer).toBe(0);
    expect(s.turnState.dice).toHaveLength(5);
    s = run(s, "p1", { type: "ROLL" }, ["1", "1", "1", "2", "2"]);
    s = run(s, "p1", { type: "RESOLVE" });
    s = run(s, "p1", { type: "END_TURN" });
    expect(s.currentPlayer).toBe(0);
    expect(s.turnState.dice).toHaveLength(4);
    s = run(s, "p1", { type: "ROLL" }, ["2", "2", "3", "3"]);
    s = run(s, "p1", { type: "RESOLVE" });
    s = run(s, "p1", { type: "END_TURN" });
    expect(s.currentPlayer).toBe(1);
  });
  it("#33 孩子们的朋友：每次得能量多 1", () => {
    const s = resolve({ p: { 0: { cards: ["friend-of-children"] }, 1: { location: "city" } } }, ["energy", "energy", "1", "2", "heart", "heart"]);
    expect(p(s, "p1").energy).toBe(3);
  });
  it("#34 巨脑：每回合多 1 次重掷", () => {
    const s = endTurnOf(buildState({ stage: "buy", current: 3, p: { 0: { cards: ["giant-brain"] } } }), "p4");
    expect(s.turnState.rollsLeft).toBe(4);
  });
  it("#35 美食家：计分三个 1 多 +2", () => {
    const s = resolve({ p: { 0: { cards: ["gourmet"] }, 1: { location: "city" } } }, ["1", "1", "1", "energy", "heart", "heart"]);
    expect(p(s, "p1").vp).toBe(3);
  });
  it("#37 草食动物：自己回合没伤害任何怪兽 +1 分", () => {
    let s = resolve({ p: { 0: { cards: ["herbivore"] }, 1: { location: "city" } } }, ["1", "2", "3", "energy", "heart", "heart"]);
    s = run(s, "p1", { type: "END_TURN" });
    expect(p(s, "p1").vp).toBe(1);
    let t = resolve({ p: { 0: { cards: ["herbivore"] }, 1: { location: "city" } } }, ["claw", "2", "3", "energy", "heart", "heart"]);
    t = run(t, "p2", { type: "YIELD", yield: false });
    t = run(t, "p1", { type: "END_TURN" });
    expect(p(t, "p1").vp).toBe(0);
  });
  it("#38 剔除弱者：每回合一次把一颗骰改成 1", () => {
    let s = buildState({ dice: ["1", "1", "2", "claw", "energy", "heart"], rolls: 1, rollsLeft: 2, p: { 0: { cards: ["herd-culler"] } } });
    s = run(s, "p1", { type: "CHANGE_DIE", index: 2, face: "1", via: "herd-culler" });
    expect(s.turnState.dice[2]!.face).toBe("1");
    expect(() => run(s, "p1", { type: "CHANGE_DIE", index: 3, face: "1", via: "herd-culler" })).toThrow("用过了");
    expect(() => run(buildState({ dice: ["2", "2", "2", "2", "2", "2"], p: { 0: { cards: ["herd-culler"] } } }), "p1", { type: "CHANGE_DIE", index: 0, face: "3", via: "herd-culler" })).toThrow("只能改成 1");
  });
  it("#39 它有个孩子：倒下时弃掉所有卡、分数清零、回 10 血继续，离开城心；只生效一次", () => {
    const s = resolve({ current: 1, p: { 0: { location: "city", life: 2, vp: 12, energy: 5, cards: ["it-has-a-child", "armor-plating"] } } }, ["claw", "claw", "1", "energy", "heart", "heart"]);
    expect(p(s, "p1")).toMatchObject({ alive: true, life: 10, vp: 0, energy: 5, location: null, cards: [] });
    expect(s.city).toBe("p2");
    expect(s.events.some((event) => event.type === "Reborn")).toBe(true);
  });
  it("#40 喷气式：让位就不吃这次伤害（挨打前先问）；留下照吃", () => {
    const hit = resolve({ current: 1, p: { 0: { location: "city", cards: ["jets"] } } }, ["claw", "claw", "claw", "energy", "heart", "heart"]);
    expect(hit.prompt).toMatchObject({ kind: "yield", player: "p1", jetsBefore: true, damage: 3 });
    expect(p(hit, "p1").life).toBe(10);
    const yielded = run(hit, "p1", { type: "YIELD", yield: true });
    expect(p(yielded, "p1").life).toBe(10);
    expect(yielded.city).toBe("p2");
    const stayed = run(hit, "p1", { type: "YIELD", yield: false });
    expect(p(stayed, "p1").life).toBe(7);
    expect(stayed.city).toBe("p1");
    expect(stayed.prompt).toBeUndefined();
  });
  it("#41 实验室出品：买牌时能买牌堆顶那张", () => {
    const state = buildState({ stage: "buy", deckTop: ["skyscraper"], p: { 0: { energy: 6, cards: ["made-in-a-lab"] } } });
    const s = run(state, "p1", { type: "BUY", uid: state.deck[0]!.uid });
    expect(p(s, "p1").vp).toBe(4);
    expect(() => run(buildState({ stage: "buy", deckTop: ["skyscraper"], p: { 0: { energy: 6 } } }), "p1", { type: "BUY", uid: state.deck[0]!.uid })).toThrow("买不到");
  });
  it("#42 变形：卖掉自己的保留卡，按印刷价（不是实付价）换能量，回合结束到账", () => {
    let s = buildState({ stage: "buy", p: { 0: { energy: 0, cards: ["metamorph", "wings", "alien-metabolism"] } } });
    s = run(s, "p1", { type: "SELL", uid: p(s, "p1").cards.find((card) => card.id === "wings")!.uid });
    expect(p(s, "p1").energy).toBe(0);
    expect(s.turnState.metamorphEnergy).toBe(6);
    s = run(s, "p1", { type: "END_TURN" });
    expect(p(s, "p1").energy).toBe(6);
    expect(s.discard.at(-1)!.id).toBe("wings");
  });
  it("#43 模仿：当作自己也有一张；回合开始前花 1 能量换目标；目标离场标记收回", () => {
    let state = buildState({ stage: "buy", current: 0, market: ["mimic", "heal", "tanks"], p: { 0: { energy: 9 }, 1: { cards: ["extra-head", "giant-brain"] } } });
    const head = p(state, "p2").cards[0]!.uid;
    const brain = p(state, "p2").cards[1]!.uid;
    state = run(state, "p1", { type: "BUY", uid: state.market[0]!.uid, mimicTarget: head });
    expect(p(state, "p1").cards[0]!.mimic).toBe(head);
    // 绕一圈回到 p1：多 1 颗骰
    for (const id of ["p1", "p2", "p3", "p4"]) {
      if (id !== "p1") {
        state = run(state, id, { type: "ROLL" }, ["1", "2", "3", "heart", "heart", "heart", "heart"]);
        if (!state.turnState.resolved) state = run(state, id, { type: "RESOLVE" });
      }
      state = run(state, id, { type: "END_TURN" });
    }
    expect(state.currentPlayer).toBe(0);
    expect(state.turnState.dice).toHaveLength(7);
    // 花 1 能量换成巨脑（换目标在掷骰前，本回合的骰子数不变）
    const energy = p(state, "p1").energy;
    state = run(state, "p1", { type: "MIMIC", target: brain });
    expect(p(state, "p1").energy).toBe(energy - 1);
    expect(p(state, "p1").cards[0]!.mimic).toBe(brain);
    // 掷过之后不能换
    const rolled = run(state, "p1", { type: "ROLL" }, ["1", "2", "3", "heart", "heart", "heart", "heart"]);
    expect(() => run(rolled, "p1", { type: "MIMIC", target: head })).toThrow("第一次掷骰前");
    // 目标的主人出局 → 标记收回
    const dead = buildState({ current: 1, p: { 0: { location: "city", life: 1, cards: ["regeneration"] }, 2: { cards: ["mimic"] } } });
    const mimicCard = p(dead, "p3").cards[0]!;
    mimicCard.mimic = p(dead, "p1").cards[0]!.uid;
    const after = run({ ...dead, turnState: { ...dead.turnState, dice: ["claw", "1", "2", "3", "3", "heart"].map((face) => ({ face: face as Face, green: false })), rolls: 3, rollsLeft: 0 } }, "p2", { type: "RESOLVE" });
    expect(p(after, "p3").cards[0]!.mimic).toBeUndefined();
    // 不能模仿烟雾、电池、剧情反转和模仿自己
    expect(() => run(buildState({ stage: "buy", market: ["mimic", "heal", "tanks"], p: { 0: { energy: 9 }, 1: { cards: ["smoke-cloud"] } } }), "p1", { type: "BUY", uid: "x", mimicTarget: "y" })).toThrow();
  });
  it("#44 怪兽电池：买时存入能量、银行补同样多；每回合开始取 2，取空弃卡", () => {
    let s = buy("monster-batteries", { p: { 0: { energy: 5 } } }, { batteryEnergy: 3 });
    const card = p(s, "p1").cards[0]!;
    expect(card.battery).toBe(6);
    expect(p(s, "p1").energy).toBe(0);
    s = run(s, "p1", { type: "END_TURN" });
    for (const id of ["p2", "p3", "p4"]) {
      s = run(s, id, { type: "ROLL" }, ["1", "2", "3", "heart", "heart", "heart"]);
      s = run(s, id, { type: "RESOLVE" });
      s = run(s, id, { type: "END_TURN" });
    }
    expect(p(s, "p1").energy).toBe(2);
    expect(p(s, "p1").cards[0]!.battery).toBe(4);
    // 只剩 2：取完弃卡
    const last = buildState({ stage: "buy", current: 3, p: { 0: { cards: ["monster-batteries"] } } });
    p(last, "p1").cards[0]!.battery = 2;
    const next = run(last, "p4", { type: "END_TURN" });
    expect(p(next, "p1").energy).toBe(2);
    expect(p(next, "p1").cards).toEqual([]);
  });
  it("#45 新星吐息：你的攻击打所有其他怪兽", () => {
    const s = resolve({ p: { 0: { cards: ["nova-breath"] }, 1: { location: "city" } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect([p(s, "p2").life, p(s, "p3").life, p(s, "p4").life]).toEqual([9, 9, 9]);
  });
  it("#46 杂食动物：1、2、3 各一颗 +2 分（这三颗还能算别的组合）", () => {
    const s = resolve({ p: { 0: { cards: ["omnivore"] }, 1: { location: "city" } } }, ["1", "2", "3", "3", "3", "heart"]);
    expect(p(s, "p1").vp).toBe(5);
  });
  it("#48 寄生触手：按价格买别的怪兽的保留卡，能量付给它", () => {
    const state = buildState({ stage: "buy", p: { 0: { energy: 6, cards: ["parasitic-tentacles"] }, 2: { energy: 1, cards: ["armor-plating"] } } });
    const uid = p(state, "p3").cards[0]!.uid;
    const s = run(state, "p1", { type: "BUY", uid });
    expect(p(s, "p1").energy).toBe(2);
    expect(p(s, "p3").energy).toBe(5);
    expect(p(s, "p1").cards.map((card) => card.id)).toEqual(["parasitic-tentacles", "armor-plating"]);
    expect(p(s, "p3").cards).toEqual([]);
    expect(() => run(buildState({ stage: "buy", p: { 0: { energy: 6 }, 2: { cards: ["armor-plating"] } } }), "p1", { type: "BUY", uid })).toThrow("买不到");
  });
  it("#49 剧情反转：把一颗骰改成任意面，用后弃掉", () => {
    const s = run(buildState({ dice: ["3", "3", "1", "claw", "energy", "heart"], p: { 0: { cards: ["plot-twist"] } } }), "p1", { type: "CHANGE_DIE", index: 2, face: "3", via: "plot-twist" });
    expect(s.turnState.dice[2]!.face).toBe("3");
    expect(p(s, "p1").cards).toEqual([]);
    expect(s.discard.at(-1)!.id).toBe("plot-twist");
  });
  it("#50 毒刺：计分三个 2 时攻击多 2 伤害", () => {
    const s = resolve({ p: { 0: { cards: ["poison-quills"] }, 1: { location: "city" } } }, ["2", "2", "2", "energy", "heart", "heart"]);
    expect(p(s, "p2").life).toBe(8);
    expect(s.prompt).toMatchObject({ kind: "yield" });
  });
  it("#51 毒液：造成伤害给对方中毒标记；回合结束每个标记掉 1 血；城外用心去标记", () => {
    let s = resolve({ p: { 0: { cards: ["poison-spit"] }, 1: { location: "city" } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(s, "p2").poison).toBe(1);
    s = run(s, "p2", { type: "YIELD", yield: true });
    s = run(s, "p1", { type: "END_TURN" });
    s = run(s, "p2", { type: "ROLL" }, ["1", "2", "3", "energy", "3", "2"]);
    s = run(s, "p2", { type: "RESOLVE" });
    s = run(s, "p2", { type: "END_TURN" });
    expect(p(s, "p2").life).toBe(8);
    // 心去标记，不回血
    const cure = resolve({ p: { 0: { poison: 2, shrink: 1, life: 6 }, 1: { location: "city" } } }, ["heart", "heart", "heart", "heart", "1", "2"]);
    expect(p(cure, "p1")).toMatchObject({ poison: 0, shrink: 0, life: 7 });
    // 在城里不能去
    const inCity = resolve({ p: { 0: { poison: 2, location: "city" } } }, ["heart", "heart", "1", "2", "3", "energy"]);
    expect(p(inCity, "p1").poison).toBe(2);
  });
  it("#53 快速治疗：任何时候花 2 能量回 1 血；满血不行", () => {
    const state = buildState({ current: 0, p: { 2: { cards: ["rapid-healing"], energy: 3, life: 5 } } });
    const s = run(state, "p3", { type: "RAPID_HEAL" });
    expect(p(s, "p3")).toMatchObject({ life: 6, energy: 1 });
    expect(() => run(buildState({ p: { 2: { cards: ["rapid-healing"], energy: 3 } } }), "p3", { type: "RAPID_HEAL" })).toThrow("满了");
    expect(() => run(buildState({ p: { 2: { energy: 3, life: 4 } } }), "p3", { type: "RAPID_HEAL" })).toThrow("没有快速治疗");
  });
  it("#54 再生：回血时多回 1", () => {
    const s = resolve({ p: { 0: { cards: ["regeneration"], life: 5 }, 1: { location: "city" } } }, ["heart", "1", "2", "3", "energy", "energy"]);
    expect(p(s, "p1").life).toBe(7);
  });
  it("#55 为弱者加油：回合结束时分数最少（并列也算）+1", () => {
    const s = endTurnOf(buildState({ stage: "buy", p: { 0: { vp: 2, cards: ["rooting-for-the-underdog"] }, 1: { vp: 2 }, 2: { vp: 5 }, 3: { vp: 4 } } }), "p1");
    expect(p(s, "p1").vp).toBe(3);
    const no = endTurnOf(buildState({ stage: "buy", p: { 0: { vp: 3, cards: ["rooting-for-the-underdog"] }, 1: { vp: 2 } } }), "p1");
    expect(p(no, "p1").vp).toBe(3);
  });
  it("#56 缩小射线：造成伤害给缩小标记；每个标记少掷 1 颗", () => {
    let s = resolve({ current: 0, p: { 0: { cards: ["shrink-ray"] }, 1: { location: "city" } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(s, "p2").shrink).toBe(1);
    s = run(s, "p2", { type: "YIELD", yield: false });
    s = run(s, "p1", { type: "END_TURN" });
    expect(s.turnState.dice).toHaveLength(5);
  });
  it("#57 烟雾：3 个标记各换一次额外重掷，用完弃掉", () => {
    let s = buildState({ dice: ["1", "1", "2", "claw", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { cards: ["smoke-cloud"] }, 1: { location: "city" } } });
    for (let i = 0; i < 3; i += 1) s = run(s, "p1", { type: "ROLL", keep: [0, 1, 2, 3, 4], use: "smoke" }, ["heart"]);
    expect(p(s, "p1").cards).toEqual([]);
    expect(s.turnState.resolved).toBe(true);
  });
  it("#58 太阳能：回合结束时能量为 0 → +1", () => {
    expect(p(endTurnOf(buildState({ stage: "buy", p: { 0: { cards: ["solar-powered"] } } }), "p1"), "p1").energy).toBe(1);
    expect(p(endTurnOf(buildState({ stage: "buy", p: { 0: { energy: 2, cards: ["solar-powered"] } } }), "p1"), "p1").energy).toBe(2);
  });
  it("#59 尖刺尾巴：攻击时多 1", () => {
    const s = resolve({ p: { 0: { cards: ["spiked-tail"] }, 1: { location: "city" } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(s, "p2").life).toBe(8);
  });
  it("#60 弹性：花 2 能量把一颗骰改成任意面", () => {
    const s = run(buildState({ dice: ["3", "3", "1", "claw", "energy", "heart"], p: { 0: { energy: 3, cards: ["stretchy"] } } }), "p1", { type: "CHANGE_DIE", index: 2, face: "3", via: "stretchy" });
    expect(s.turnState.dice[2]!.face).toBe("3");
    expect(p(s, "p1").energy).toBe(1);
    expect(() => run(s, "p1", { type: "CHANGE_DIE", index: 3, face: "3", via: "stretchy" })).toThrow("能量不够");
  });
  it("#61 心灵感应：花 1 能量多重掷 1 次", () => {
    const s = run(buildState({ dice: ["1", "1", "2", "claw", "energy", "heart"], rolls: 3, rollsLeft: 0, p: { 0: { energy: 1, cards: ["telepath"] } } }), "p1", { type: "ROLL", keep: [0, 1], use: "telepath" }, ["1", "1", "1", "1"]);
    expect(p(s, "p1").energy).toBe(0);
    expect(s.turnState.dice.map((die) => die.face)).toEqual(["1", "1", "1", "1", "1", "1"]);
    expect(s.turnState.resolved).toBe(true);
  });
  it("#62 城市吞噬者：回合开始在城里多 +1 分；在城里造成伤害多 1", () => {
    const start = endTurnOf(buildState({ stage: "buy", current: 3, p: { 0: { location: "city", cards: ["urbavore"] } } }), "p4");
    expect(p(start, "p1").vp).toBe(3);
    const attack = resolve({ p: { 0: { location: "city", cards: ["urbavore"] } } }, ["claw", "1", "2", "energy", "heart", "heart"]);
    expect(p(attack, "p2").life).toBe(8);
  });
  it("#63 越打越强：一次掉 2 血或以上 +1 能量", () => {
    const s = resolve({ current: 1, p: { 0: { location: "city", cards: ["were-only-making-it-stronger"] } } }, ["claw", "claw", "1", "energy", "heart", "heart"]);
    expect(p(s, "p1").energy).toBe(1);
    const one = resolve({ current: 1, p: { 0: { location: "city", cards: ["were-only-making-it-stronger"] } } }, ["claw", "2", "1", "energy", "heart", "heart"]);
    expect(p(one, "p1").energy).toBe(0);
  });
  it("#64 双翼：挨打时问，花 2 能量这回合不再受伤害", () => {
    const hit = resolve({ current: 1, p: { 0: { location: "city", energy: 2, cards: ["wings"] } } }, ["claw", "claw", "1", "energy", "heart", "heart"]);
    expect(hit.prompt).toMatchObject({ kind: "wings", player: "p1", damage: 2 });
    const used = run(hit, "p1", { type: "WINGS", use: true });
    expect(p(used, "p1")).toMatchObject({ life: 10, energy: 0, wingsActive: true });
    // 没掉血：不能让位，攻击者也进不了城
    expect(used.city).toBe("p1");
    expect(used.stage).toBe("buy");
    // 同一回合后面的卡牌伤害也免
    const later = buildState({ stage: "buy", market: ["fire-blast", "heal", "tanks"], current: 1, p: { 0: { energy: 2, cards: ["wings"] }, 1: { energy: 3 } } });
    let s = run(later, "p2", { type: "BUY", uid: later.market[0]!.uid });
    expect(s.prompt).toMatchObject({ kind: "wings", player: "p1" });
    s = run(s, "p1", { type: "WINGS", use: true });
    expect(p(s, "p1").life).toBe(10);
    // 回合结束后失效
    s = run(s, "p2", { type: "END_TURN" });
    expect(p(s, "p1").wingsActive).toBeUndefined();
    // 不用：照扣
    const declined = run(hit, "p1", { type: "WINGS", use: false });
    expect(p(declined, "p1").life).toBe(8);
    expect(declined.prompt).toMatchObject({ kind: "yield", player: "p1" });
  });
});
