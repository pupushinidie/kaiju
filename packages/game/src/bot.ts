/**
 * 人机（「普通」难度）：像一个认真玩、会算账的普通玩家，不作弊。
 * 输入必须是 redactGameForViewer(game, playerId) 处理过的状态（看不到牌堆顺序）。
 * botDecision 同时给出一句玩家听得懂的理由，教程的「提示」按钮用它。
 */
import { CARDS, type CardId } from "./cards.js";
import {
  actorId,
  alivePlayers,
  cardCount,
  cardPrice,
  clawTargets,
  currentPlayer,
  hasCard,
  maxLifeOf,
  mimicTargets,
  scoreDice,
} from "./engine.js";
import type { CardInstance, Face, GameCommand, GameState, Player } from "./types.js";

/** 可调参数（模拟脚本用来比较；线上用默认值）。 */
export const botTuning = {
  /** 只剩 2 只时还留 1、2 的对子吗。 */
  duelPairs: false,
  /** 只剩 2 只时留 3 的对子吗。 */
  duelPairThree: false,
  /** 留在城里的最低血量（≥ 这个就留）。 */
  stayLife: 7,
  /** 2 只时的留城血量。 */
  duelStayLife: 7,
  /** 买卡门槛：价值 - 价格/energyRate 超过它才买。 */
  buyThreshold: 0.3,
  energyRate: 4,
  /** 只剩 2 只时血少也留爪。 */
  duelClaws: true,
  /** 只剩 2 只时，三个 1 / 三个 2 也重掷（只留三个 3 以上），全力打。 */
  duelBrawl: true,
  /** 只剩 2 只、自己分数不高时，加分卡打几折（这时多半是比谁先打倒谁）。 */
  duelVpScale: 0.3,
  duelEnergyRate: 5,
};

export interface BotDecision {
  readonly command: GameCommand;
  readonly reason: string;
}

export function botCommand(state: GameState, playerId: string): GameCommand | null {
  return botDecision(state, playerId)?.command ?? null;
}

export function botDecision(state: GameState, playerId: string): BotDecision | null {
  if (state.phase === "finished" || actorId(state) !== playerId) return null;
  const me = state.players.find((player) => player.id === playerId);
  if (!me) return null;
  if (state.prompt?.kind === "yield") return decideYield(state, me);
  if (state.prompt?.kind === "wings") return decideWings(state, me);
  if (state.stage === "roll") return decideRoll(state, me);
  return decideBuy(state, me);
}

// ---------------------------------------------------------------- 让位、双翼

/** 下一轮城外的怪兽大概能打出几爪（每只约 1.3 爪）。 */
function expectedIncoming(state: GameState, me: Player): number {
  const attackers = alivePlayers(state).filter((player) => player.id !== me.id && !player.location);
  let total = 0;
  for (const attacker of attackers) {
    total += 1.3 + cardCount(state, attacker, "spiked-tail") + cardCount(state, attacker, "acid-attack");
  }
  return total;
}

function decideYield(state: GameState, me: Player): BotDecision {
  const prompt = state.prompt!;
  if (prompt.kind !== "yield") throw new Error("不是让位");
  const lifeAfter = prompt.jetsBefore ? me.life - prompt.damage : me.life;
  const yes = (reason: string): BotDecision => ({ command: { type: "YIELD", yield: true }, reason });
  const no = (reason: string): BotDecision => ({ command: { type: "YIELD", yield: false }, reason });
  if (lifeAfter <= 0) return yes("不让位就要倒下了，让出去保命");
  const incoming = expectedIncoming(state, me);
  const toWin = state.config.winVp - me.vp;
  // 回合开始还在城里 +2 分：离 20 分很近时赌一把
  if (toWin <= 2 && lifeAfter > incoming * 0.8) return no(`只差 ${toWin} 分，留在城里等回合开始的 +2 分`);
  const stayLife = alivePlayers(state).length === 2 ? botTuning.duelStayLife : botTuning.stayLife;
  if (lifeAfter >= stayLife) return no(`还有 ${lifeAfter} 血，留在城里下回合 +2 分`);
  if (lifeAfter <= 5 && incoming >= lifeAfter - 1) return yes(`只剩 ${lifeAfter} 血，下一轮可能挨 ${Math.round(incoming)} 下，让位回城外回血`);
  if (lifeAfter <= 4) return yes(`只剩 ${lifeAfter} 血，让位回城外回血`);
  if (toWin <= 4) return no(`离 20 分只差 ${toWin} 分，留下赌一把`);
  if (lifeAfter <= 5) return yes(`只剩 ${lifeAfter} 血，让位更稳`);
  return no(`还有 ${lifeAfter} 血，留在城里继续拿分`);
}

function decideWings(state: GameState, me: Player): BotDecision {
  const prompt = state.prompt!;
  if (prompt.kind !== "wings") throw new Error("不是双翼");
  if (me.energy >= 2 && prompt.damage >= me.life) return { command: { type: "WINGS", use: true }, reason: `这下 ${prompt.damage} 点会打倒你，花 2 能量飞走` };
  if (me.energy >= 4 && prompt.damage >= 3) return { command: { type: "WINGS", use: true }, reason: `这下要掉 ${prompt.damage} 血，能量够，用双翼躲开` };
  if (me.energy >= 2 && prompt.damage >= 2 && me.life <= 5) return { command: { type: "WINGS", use: true }, reason: "血不多了，用双翼躲开" };
  return { command: { type: "WINGS", use: false }, reason: "伤害不大，留着能量" };
}

// ---------------------------------------------------------------- 掷骰

interface KeepPlan {
  readonly keep: number[];
  readonly why: string;
}

/** 想留下哪些骰子。 */
function planKeep(state: GameState, me: Player): KeepPlan {
  const dice = state.turnState.dice.map((die) => die.face!);
  const count = (face: Face) => dice.filter((candidate) => candidate === face).length;
  const keep = new Set<number>();
  const whys: string[] = [];
  const toWin = state.config.winVp - me.vp;

  // 数字：三个以上的都留；没有三个时留一对（3 优先，其次 2；1 只在有美食家/冻结时间时）
  const brawl = botTuning.duelBrawl && alivePlayers(state).length === 2 && toWin > 6;
  const triples = (["3", "2", "1"] as const).filter((face) => count(face) >= 3 && (!brawl || face === "3" || count(face) >= 4));
  for (const face of triples) dice.forEach((d, i) => d === face && keep.add(i));
  if (triples.length > 0) whys.push(`留下 ${triples.map((face) => `${count(face)} 个 ${face}`).join("、")}`);
  else {
    const likesOnes = hasCard(state, me, "gourmet") || hasCard(state, me, "freeze-time");
    const duel = alivePlayers(state).length === 2 && toWin > 4;
    const pair = (["3", "2", "1"] as const).find((face) => count(face) === 2
      && (face !== "1" || likesOnes || toWin <= 2)
      && (!duel || botTuning.duelPairs || (face === "3" && botTuning.duelPairThree)));
    if (pair) {
      dice.forEach((d, i) => d === pair && keep.add(i));
      whys.push(`留下两个 ${pair} 去凑三个`);
    } else if (toWin <= 4 && count("3") === 1) {
      dice.forEach((d, i) => d === "3" && keep.add(i));
    }
  }
  if (hasCard(state, me, "omnivore") && count("1") >= 1 && count("2") >= 1 && count("3") >= 1) {
    for (const face of ["1", "2", "3"] as const) keep.add(dice.indexOf(face));
  }

  // 爪
  const targets = clawTargets(state, me);
  const claws = count("claw");
  if (claws > 0 && targets.length > 0) {
    const weakest = Math.min(...targets.map((target) => target.life));
    const inCity = me.location !== null;
    const lowSelf = me.life <= 4 && !inCity && !(botTuning.duelClaws && alivePlayers(state).length === 2);
    const canKill = weakest <= claws + cardCount(state, me, "spiked-tail");
    if (inCity || canKill || !lowSelf) {
      dice.forEach((d, i) => d === "claw" && keep.add(i));
      if (canKill) whys.push(`留爪，能把只剩 ${weakest} 血的怪兽打倒`);
      else if (inCity) whys.push("在城里，爪打城外所有怪兽");
      else whys.push("留爪打城里的怪兽");
    }
  }

  // 心：在城外按缺的血留
  if (!me.location) {
    const missing = maxLifeOf(state, me) - me.life + me.poison + me.shrink;
    let hearts = 0;
    dice.forEach((d, i) => {
      if (d === "heart" && hearts < missing) {
        keep.add(i);
        hearts += 1;
      }
    });
    if (hearts > 0 && me.life <= 6) whys.push(`留 ${hearts} 颗心回血`);
  }

  // 能量：总是留
  dice.forEach((d, i) => d === "energy" && keep.add(i));
  return { keep: [...keep].sort((a, b) => a - b), why: whys.join("，") };
}

function decideRoll(state: GameState, me: Player): BotDecision {
  const ts = state.turnState;
  // 第一次掷之前：模仿标记没地方放就放一下
  if (ts.rolls === 0) {
    const mimic = me.cards.find((card) => card.id === "mimic");
    if (mimic && !mimic.mimic && me.energy >= 3) {
      const best = bestMimicTarget(state, me);
      if (best) return { command: { type: "MIMIC", target: best.uid }, reason: `花 1 能量模仿「${CARDS[best.id].name}」` };
    }
    if (ts.dice.length === 0) return { command: { type: "RESOLVE" }, reason: "一颗骰子都没有，直接结算" };
    return { command: { type: "ROLL" }, reason: "先把骰子掷出去" };
  }
  const dice = ts.dice.map((die) => die.face!);
  const plan = planKeep(state, me);
  const reroll = dice.map((_, i) => i).filter((i) => !plan.keep.includes(i));

  // 背景住户：只想重掷 3 时免费
  if (reroll.length > 0 && hasCard(state, me, "background-dweller") && ts.dwellerRerolls < 10 && reroll.every((i) => dice[i] === "3")) {
    return { command: { type: "ROLL", keep: plan.keep }, reason: "背景住户：免费重掷不要的 3" };
  }
  if (reroll.length > 0 && ts.rollsLeft > 0) {
    return { command: { type: "ROLL", keep: plan.keep }, reason: `${plan.why || "这几颗都没用"}，重掷其余 ${reroll.length} 颗` };
  }
  // 次数用完：烟雾 / 心灵感应
  if (reroll.length >= 3) {
    if (me.cards.some((card) => card.id === "smoke-cloud" && (card.smoke ?? 0) > 0)) {
      return { command: { type: "ROLL", keep: plan.keep, use: "smoke" }, reason: "用一个烟雾标记再掷一次" };
    }
    if (hasCard(state, me, "telepath") && me.energy >= 4) {
      return { command: { type: "ROLL", keep: plan.keep, use: "telepath" }, reason: "花 1 能量（心灵感应）再掷一次" };
    }
  }
  // 改骰：能凑出三个就改
  const change = planChange(state, me, dice, plan);
  if (change) return change;
  return { command: { type: "RESOLVE" }, reason: describeResolve(state, me, dice) };
}

/** 剔除弱者 / 剧情反转 / 弹性：改一颗没用的骰子凑出三个一样的数字。 */
function planChange(state: GameState, me: Player, dice: Face[], plan: KeepPlan): BotDecision | null {
  const ts = state.turnState;
  const count = (face: Face) => dice.filter((candidate) => candidate === face).length;
  const spareFor = (face: Face) => dice.map((_, i) => i).find((i) => !plan.keep.includes(i) && dice[i] !== face);
  const spareOne = spareFor("1");
  if (spareOne !== undefined && hasCard(state, me, "herd-culler") && !ts.herdCullerUsed && count("1") === 2) {
    const spare = spareOne;
    return { command: { type: "CHANGE_DIE", index: spare, face: "1", via: "herd-culler" }, reason: "剔除弱者：把一颗改成 1，凑出三个 1" };
  }
  const target = (["3", "2"] as const).find((face) => count(face) === 2);
  const spare = target ? spareFor(target) : undefined;
  if (spare === undefined || !target) return null;
  if (me.cards.some((card) => card.id === "plot-twist") && state.config.winVp - me.vp <= Number(target) + 1) {
    return { command: { type: "CHANGE_DIE", index: spare, face: target, via: "plot-twist" }, reason: `剧情反转：改出第三个 ${target}，冲 20 分` };
  }
  if (target === "3" && hasCard(state, me, "stretchy") && me.energy >= 2) {
    return { command: { type: "CHANGE_DIE", index: spare, face: "3", via: "stretchy" }, reason: "弹性：花 2 能量改出第三个 3" };
  }
  return null;
}

function describeResolve(state: GameState, me: Player, dice: Face[]): string {
  const parts: string[] = [];
  const vp = scoreDice(dice);
  if (vp > 0) parts.push(`+${vp} 分`);
  const energy = dice.filter((face) => face === "energy").length;
  if (energy > 0) parts.push(`+${energy} 能量`);
  const claws = dice.filter((face) => face === "claw").length;
  if (claws > 0 && clawTargets(state, me).length > 0) parts.push(`打出 ${claws} 爪`);
  const hearts = dice.filter((face) => face === "heart").length;
  if (hearts > 0 && !me.location && me.life < maxLifeOf(state, me)) parts.push(`回 ${hearts} 血`);
  if (!me.location && !state.city) parts.push("然后进城心");
  return parts.length > 0 ? `结算：${parts.join("，")}` : "结算这把骰子";
}

// ---------------------------------------------------------------- 买牌

/** 一张保留卡每回合大约值几分（粗估）。 */
const KEEP_PER_TURN: Partial<Record<CardId, number>> = {
  "acid-attack": 0.5, "alien-metabolism": 0.25, "alpha-monster": 0.4, "armor-plating": 0.3, "background-dweller": 0.15,
  burrowing: 0.3, camouflage: 0.3, "complete-destruction": 0.15, "dedicated-news-team": 0.3, "eater-of-the-dead": 0.4,
  "energy-hoarder": 0.25, "extra-head": 0.6, "fire-breathing": 0.4, "freeze-time": 0.2, "friend-of-children": 0.3,
  "giant-brain": 0.5, gourmet: 0.15, herbivore: 0.3, "herd-culler": 0.2, jets: 0.25, "made-in-a-lab": 0.1, metamorph: 0.05,
  "nova-breath": 0.5, omnivore: 0.3, "parasitic-tentacles": 0.1, "poison-quills": 0.15, "poison-spit": 0.4, "rapid-healing": 0.2,
  regeneration: 0.25, "rooting-for-the-underdog": 0.25, "shrink-ray": 0.4, "solar-powered": 0.15, "spiked-tail": 0.5,
  stretchy: 0.2, telepath: 0.2, urbavore: 0.4, "were-only-making-it-stronger": 0.2, wings: 0.3, "even-bigger": 0.2,
};
const KEEP_FIXED: Partial<Record<CardId, number>> = {
  "it-has-a-child": 2, "plot-twist": 0.8, "smoke-cloud": 1.2, "even-bigger": 1, "monster-batteries": 0,
};

/** 估计还剩几个自己的回合。 */
function turnsLeft(state: GameState): number {
  const alive = alivePlayers(state);
  const maxVp = Math.max(...alive.map((player) => player.vp));
  const minLife = Math.min(...alive.map((player) => player.life));
  return Math.max(1, Math.min(8, Math.min((state.config.winVp - maxVp) / 2.5, 2 + minLife / 2)));
}

function damageValue(targets: Player[], me: Player, amount: number): number {
  let value = 0;
  for (const target of targets) {
    if (target.id === me.id) continue;
    value += 0.35 * Math.min(amount, target.life);
    if (target.life <= amount) value += 2.5;
  }
  return value;
}

/** 一张卡对我值几分（买到就有的）。 */
export function cardValue(state: GameState, me: Player, id: CardId): number {
  const others = alivePlayers(state).filter((player) => player.id !== me.id);
  const missing = maxLifeOf(state, me) - me.life;
  const healValue = (n: number) => Math.min(n, missing) * (me.life <= 5 ? 1 : 0.4);
  const survive = (dmg: number) => me.life - dmg > me.poison;
  const duel = others.length === 1 && me.vp < 12;
  const vpCard = (vp: number) => vp * (duel ? botTuning.duelVpScale : 1) + (me.vp + vp >= state.config.winVp ? 30 : 0);
  switch (id) {
    case "apartment-building": return vpCard(3);
    case "commuter-train": return vpCard(2);
    case "corner-store": return vpCard(1);
    case "skyscraper": return vpCard(4);
    case "drop-from-high-altitude": return vpCard(me.location === "city" ? 2 : 3) - (me.location === "city" ? 0 : me.life <= 5 ? 2 : 0.5);
    case "energize": return 3;
    case "evacuation-orders": return 0.3 * others.reduce((n, other) => n + Math.min(5, other.vp), 0)
      + (others.some((other) => other.vp >= 16) ? 2 : 0);
    case "fire-blast": return damageValue(others, me, 2);
    case "frenzy": return 3;
    case "gas-refinery": return vpCard(2) + damageValue(others, me, 3);
    case "heal": return healValue(2);
    case "high-altitude-bombing": {
      if (!survive(3)) return -99;
      const lead = me.life - Math.max(...others.map((other) => other.life));
      return lead >= 3 ? damageValue(others, me, 3) - 1.5 : -1;
    }
    case "jet-fighters": return survive(4) ? vpCard(5) - (me.life <= 7 ? 3 : 2) : -99;
    case "national-guard": return survive(2) ? vpCard(2) - 1 : -99;
    case "tanks": return survive(3) ? vpCard(4) - 1.5 : -99;
    case "nuclear-power-plant": return vpCard(2) + healValue(3);
    case "vast-storm": return vpCard(2) + 0.1 * others.reduce((n, other) => n + Math.floor(other.energy / 2), 0);
    case "mimic": {
      const best = bestMimicTarget(state, me);
      return best ? cardValue(state, me, best.id) * 0.9 : -1;
    }
    default:
      return (KEEP_FIXED[id] ?? 0) + (KEEP_PER_TURN[id] ?? 0) * turnsLeft(state);
  }
}

function bestMimicTarget(state: GameState, me: Player): CardInstance | null {
  let best: CardInstance | null = null;
  let bestValue = 0.5;
  for (const card of mimicTargets(state)) {
    const value = (KEEP_PER_TURN[card.id] ?? 0) * turnsLeft(state) + (KEEP_FIXED[card.id] ?? 0);
    if (value > bestValue) {
      best = card;
      bestValue = value;
    }
  }
  void me;
  return best;
}

function decideBuy(state: GameState, me: Player): BotDecision {
  if (currentPlayer(state).id !== me.id) return { command: { type: "END_TURN" }, reason: "结束回合" };
  // 血很少或快被毒死：先用快速治疗
  if (hasCard(state, me, "rapid-healing") && me.energy >= 2 && me.life < maxLifeOf(state, me) && (me.life <= 3 || me.life <= me.poison)) {
    return { command: { type: "RAPID_HEAL" }, reason: "血太少，花 2 能量回 1 血" };
  }
  const options: { card: CardInstance; price: number; from: string }[] = [];
  for (const card of state.market) if (card) options.push({ card, price: cardPrice(state, me, card.id), from: "market" });
  if (state.peek) options.push({ card: state.peek, price: cardPrice(state, me, state.peek.id), from: "deck" });
  if (hasCard(state, me, "parasitic-tentacles")) {
    for (const other of state.players) {
      if (other.id === me.id || !other.alive) continue;
      for (const card of other.cards) options.push({ card, price: cardPrice(state, me, card.id), from: other.name });
    }
  }
  let best: { card: CardInstance; price: number; net: number; value: number; from: string } | null = null;
  for (const option of options) {
    if (option.price > me.energy) continue;
    if (option.card.id === "monster-batteries" || option.card.id === "metamorph") continue;
    const value = cardValue(state, me, option.card.id);
    const rate = alivePlayers(state).length === 2 ? botTuning.duelEnergyRate : botTuning.energyRate;
    const net = value - option.price / rate;
    if (!best || net > best.net) best = { ...option, net, value };
  }
  if (best && best.net > botTuning.buyThreshold) {
    const chosen = best;
    const target = chosen.card.id === "mimic" ? bestMimicTarget(state, me) : null;
    const command: GameCommand = target ? { type: "BUY", uid: chosen.card.uid, mimicTarget: target.uid } : { type: "BUY", uid: chosen.card.uid };
    const def = CARDS[chosen.card.id];
    const where = chosen.from === "market" ? "" : chosen.from === "deck" ? "（牌堆顶）" : `（从${chosen.from}那里）`;
    const why = chosen.value >= 30 ? "，买了就到 20 分" : `：${def.text}`;
    return { command, reason: `花 ${chosen.price} 能量买「${def.name}」${where}${why}` };
  }
  // 三张都不值、能量还多：扫掉换一批
  if (me.energy >= 8 && (!best || best.net < -0.5)) {
    return { command: { type: "SWEEP" }, reason: "这三张都不划算，花 2 能量换一批" };
  }
  return { command: { type: "END_TURN" }, reason: me.energy > 0 ? `没有划算的卡，攒着 ${me.energy} 能量，结束回合` : "结束回合" };
}
