import { CARDS, UNMIMICABLE, fullDeck, type CardId } from "./cards.js";
import { createRng, type Rng } from "./rng.js";
import {
  FACES,
  MONSTER_IDS,
  type CardInstance,
  type Config,
  type Die,
  type Face,
  type GameCommand,
  type GameEvent,
  type GameState,
  type Hit,
  type MonsterId,
  type Player,
  type Spot,
  type Task,
  type TurnState,
  type VpReason,
} from "./types.js";

export function defaultConfig(_playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 2,
    maxPlayers: 6,
    winVp: 20,
    maxLife: 10,
    twoPlayerEnergy: true,
    rollTimeoutSec: 40,
    yieldTimeoutSec: 20,
    buyTimeoutSec: 30,
    reactTimeoutSec: 10,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
  /** 等候房间里选的怪兽；没选或和别人重复时随机分配。 */
  readonly monster?: MonsterId | undefined;
}

/** 一次结算的上下文：可变的新状态、随机数、产生的事件。 */
interface Ctx {
  readonly s: GameState;
  readonly rng: Rng;
  readonly ev: GameEvent[];
}

const BASE_DICE = 6;
const MAX_DICE = 8;
const BASE_ROLLS = 3;
const DWELLER_LIMIT = 10;
const RECENT_LIMIT = 80;

// ---------------------------------------------------------------- 查询

export function currentPlayer(state: GameState): Player {
  const player = state.players[state.currentPlayer];
  if (!player) throw new Error("找不到当前玩家。");
  return player;
}

export function playerById(state: GameState, id: string): Player {
  const player = state.players.find((candidate) => candidate.id === id);
  if (!player) throw new Error("找不到这位玩家。");
  return player;
}

export function alivePlayers(state: GameState): Player[] {
  return state.players.filter((player) => player.alive);
}

/** 现在该谁操作：有问题等人回答时是被问的人，否则是当前回合的玩家。 */
export function actorId(state: GameState): string {
  if (state.phase === "finished") return "";
  return state.prompt?.player ?? currentPlayer(state).id;
}

/** 找一张在场上（某只怪兽面前）的 KEEP 卡。 */
export function findOwnedCard(state: GameState, uid: string): { card: CardInstance; owner: Player } | null {
  for (const owner of state.players) {
    const card = owner.cards.find((candidate) => candidate.uid === uid);
    if (card) return { card, owner };
  }
  return null;
}

/** 某只怪兽实际拥有某种卡几张：自己的，加上模仿标记指着的那张。 */
export function cardCount(state: GameState, player: Player, id: CardId): number {
  let count = 0;
  for (const card of player.cards) {
    if (card.id === id) count += 1;
    if (card.id === "mimic" && card.mimic) {
      const target = findOwnedCard(state, card.mimic);
      if (target && target.card.id === id) count += 1;
    }
  }
  return count;
}

export function hasCard(state: GameState, player: Player, id: CardId): boolean {
  return cardCount(state, player, id) > 0;
}

export function maxLifeOf(state: GameState, player: Player): number {
  return state.config.maxLife + 2 * cardCount(state, player, "even-bigger");
}

/** 三个一样的数字才算分：三个 n 得 n 分，每多一个 +1。 */
export function scoreDice(faces: readonly (Face | null)[]): number {
  let vp = 0;
  for (const n of [1, 2, 3] as const) {
    const count = faces.filter((face) => face === String(n)).length;
    if (count >= 3) vp += n + (count - 3);
  }
  return vp;
}

/** 爪打谁：在城里（城心或港湾）打所有城外的；在城外打城里的（城心 + 港湾）；新星吐息打所有其他怪兽。 */
export function clawTargets(state: GameState, attacker: Player): Player[] {
  const others = orderFrom(state, attacker).filter((player) => player.id !== attacker.id && player.alive);
  if (hasCard(state, attacker, "nova-breath")) return others;
  if (attacker.location) return others.filter((player) => !player.location);
  return others.filter((player) => player.location);
}

/** 从 from 的下家开始按座位顺序排的所有玩家（最后是 from 自己）。 */
function orderFrom(state: GameState, from: Player): Player[] {
  const n = state.players.length;
  const out: Player[] = [];
  for (let offset = 1; offset <= n; offset += 1) out.push(state.players[(from.seat + offset) % n]!);
  return out;
}

/** 活着的左右邻座（只剩 2 只时就是对方一只）。 */
function neighbors(state: GameState, player: Player): Player[] {
  const alive = state.players.filter((candidate) => candidate.alive || candidate.id === player.id);
  const index = alive.findIndex((candidate) => candidate.id === player.id);
  if (alive.length < 2 || index < 0) return [];
  const left = alive[(index - 1 + alive.length) % alive.length]!;
  const right = alive[(index + 1) % alive.length]!;
  const out = [left];
  if (right.id !== left.id) out.push(right);
  return out.filter((candidate) => candidate.id !== player.id && candidate.alive);
}

function twoPlayer(state: GameState): boolean {
  return state.config.twoPlayerEnergy && state.players.length === 2;
}

export function diceCountFor(state: GameState, player: Player, freezeStack: number): number {
  const count = BASE_DICE + cardCount(state, player, "extra-head") - player.shrink - freezeStack;
  return Math.max(0, Math.min(MAX_DICE, count));
}

// ---------------------------------------------------------------- 小动作

function emit(ctx: Ctx, event: GameEvent): void {
  ctx.ev.push(event);
}

function gainVp(ctx: Ctx, player: Player, amount: number, reason: VpReason, card?: CardId): void {
  if (amount <= 0 || !player.alive) return;
  player.vp += amount;
  emit(ctx, card ? { type: "Vp", player: player.id, amount, reason, card } : { type: "Vp", player: player.id, amount, reason });
}

/** 得能量：孩子们的朋友每次多 1。 */
function gainEnergy(ctx: Ctx, player: Player, amount: number, reason: string): void {
  if (amount <= 0 || !player.alive) return;
  const total = amount + cardCount(ctx.s, player, "friend-of-children");
  player.energy += total;
  emit(ctx, { type: "Energy", player: player.id, amount: total, reason });
}

/** 回血：再生每次多回 1，不超过上限。 */
function heal(ctx: Ctx, player: Player, amount: number, reason: string): void {
  if (amount <= 0 || !player.alive) return;
  const want = amount + cardCount(ctx.s, player, "regeneration");
  const actual = Math.min(want, maxLifeOf(ctx.s, player) - player.life);
  if (actual <= 0) return;
  player.life += actual;
  emit(ctx, { type: "Healed", player: player.id, amount: actual, reason });
}

function leaveSpot(state: GameState, player: Player): Spot | null {
  const spot = player.location;
  if (state.city === player.id) state.city = null;
  if (state.bay === player.id) state.bay = null;
  player.location = null;
  return spot;
}

/** 进城心 / 港湾：+1 分（2 人局 +1 能量）。 */
function enterSpot(ctx: Ctx, player: Player, spot: Spot, how?: "drop" | "bayClosed"): void {
  leaveSpot(ctx.s, player);
  ctx.s[spot] = player.id;
  player.location = spot;
  emit(ctx, how ? { type: "Entered", player: player.id, spot, how } : { type: "Entered", player: player.id, spot });
  if (how === "bayClosed") return;
  if (twoPlayer(ctx.s)) gainEnergy(ctx, player, 1, "enter");
  else gainVp(ctx, player, 1, "enter");
}

/** 生命超过上限的扣回上限（失去「更巨大」时）。 */
function clampLives(ctx: Ctx): void {
  for (const player of ctx.s.players) {
    if (!player.alive) continue;
    const max = maxLifeOf(ctx.s, player);
    if (player.life > max) {
      const lost = player.life - max;
      player.life = max;
      emit(ctx, { type: "LifeLost", player: player.id, amount: lost, reason: "evenBigger" });
    }
  }
}

/** 一张 KEEP 卡离开主人：清掉指着它的模仿标记，生命按新上限截断。toDiscard=false 时由调用方接着放到别处。 */
function removeCard(ctx: Ctx, owner: Player, uid: string, reason: string, toDiscard = true): CardInstance {
  const index = owner.cards.findIndex((card) => card.uid === uid);
  if (index < 0) throw new Error("没有这张卡。");
  const [card] = owner.cards.splice(index, 1) as [CardInstance];
  for (const player of ctx.s.players) {
    for (const other of player.cards) {
      if (other.mimic === uid) delete other.mimic;
    }
  }
  if (toDiscard) {
    ctx.s.discard.push({ uid: card.uid, id: card.id });
    emit(ctx, { type: "CardDiscarded", player: owner.id, card: card.id, reason });
  }
  clampLives(ctx);
  return card;
}

function refillMarket(state: GameState): void {
  for (let slot = 0; slot < state.market.length; slot += 1) {
    if (!state.market[slot]) state.market[slot] = state.deck.shift() ?? null;
  }
  state.deckCount = state.deck.length;
}

// ---------------------------------------------------------------- 伤害和出局

/** 一次伤害：双翼 → 装甲板 → 伪装，然后扣血、给标记、看倒没倒。返回实际掉的血。 */
function applyDamage(ctx: Ctx, sourceId: string, target: Player, amount: number, attack: boolean): number {
  const { s } = ctx;
  if (!target.alive || amount <= 0) return 0;
  if (target.wingsActive) {
    emit(ctx, { type: "Damaged", player: target.id, source: sourceId, amount: 0, attack, blocked: amount, blockedBy: "wings" });
    return 0;
  }
  if (amount === 1 && hasCard(s, target, "armor-plating")) {
    emit(ctx, { type: "Damaged", player: target.id, source: sourceId, amount: 0, attack, blocked: 1, blockedBy: "armor-plating" });
    return 0;
  }
  let blocked = 0;
  if (hasCard(s, target, "camouflage")) {
    for (let point = 0; point < amount; point += 1) {
      if (FACES[ctx.rng.int(6)] === "heart") blocked += 1;
    }
  }
  const damage = amount - blocked;
  emit(ctx, {
    type: "Damaged",
    player: target.id,
    source: sourceId,
    amount: damage,
    attack,
    ...(blocked > 0 ? { blocked, blockedBy: "camouflage" } : {}),
  });
  if (damage <= 0) return 0;
  target.life -= damage;
  const source = s.players.find((player) => player.id === sourceId);
  if (source && source.id !== target.id) {
    if (source.id === currentPlayer(s).id) s.turnState.dealtDamage = true;
    for (let i = cardCount(s, source, "poison-spit"); i > 0; i -= 1) {
      target.poison += 1;
      emit(ctx, { type: "TokenAdded", player: target.id, token: "poison", by: source.id });
    }
    for (let i = cardCount(s, source, "shrink-ray"); i > 0; i -= 1) {
      target.shrink += 1;
      emit(ctx, { type: "TokenAdded", player: target.id, token: "shrink", by: source.id });
    }
  }
  if (attack) s.turnState.attackDamage[target.id] = (s.turnState.attackDamage[target.id] ?? 0) + damage;
  if (target.life <= 0) knockOut(ctx, target, sourceId);
  else if (damage >= 2) gainEnergy(ctx, target, cardCount(s, target, "were-only-making-it-stronger"), "stronger");
  return damage;
}

/** 生命到 0：食尸者 +3；有「它有个孩子」就重来，否则出局（卡和能量全弃）。 */
function knockOut(ctx: Ctx, player: Player, by: string | null): void {
  const { s } = ctx;
  player.life = 0;
  for (const other of s.players) {
    if (other.id !== player.id && other.alive) gainVp(ctx, other, 3 * cardCount(s, other, "eater-of-the-dead"), "eater");
  }
  if (hasCard(s, player, "it-has-a-child")) {
    for (const card of [...player.cards]) removeCard(ctx, player, card.uid, "reborn");
    player.vp = 0;
    player.life = s.config.maxLife;
    player.wingsActive = false;
    const spot = leaveSpot(s, player);
    if (spot) emit(ctx, { type: "Left", player: player.id, spot, reason: "reborn" });
    emit(ctx, { type: "Reborn", player: player.id });
    return;
  }
  player.alive = false;
  leaveSpot(s, player);
  for (const card of [...player.cards]) removeCard(ctx, player, card.uid, "eliminated");
  player.energy = 0;
  player.poison = 0;
  player.shrink = 0;
  delete player.wingsActive;
  emit(ctx, { type: "Eliminated", player: player.id, by });
}

/** 打一批人：喷火给邻座加 1；在城里有城市吞噬者加 1（攻击另算）。 */
function cardHits(ctx: Ctx, source: Player, targets: readonly Player[], amount: number): Hit[] {
  const { s } = ctx;
  const bonus = source.location ? cardCount(s, source, "urbavore") : 0;
  const hits: Hit[] = targets.map((target) => ({
    target: target.id,
    amount: target.id === source.id ? amount : amount + bonus,
  }));
  return addFireBreathing(s, source, hits);
}

function addFireBreathing(s: GameState, source: Player, hits: Hit[]): Hit[] {
  const fire = cardCount(s, source, "fire-breathing");
  if (fire <= 0) return hits;
  const out = [...hits];
  for (const neighbor of neighbors(s, source)) {
    const index = out.findIndex((hit) => hit.target === neighbor.id);
    if (index >= 0) out[index] = { ...out[index]!, amount: out[index]!.amount + fire };
    else out.push({ target: neighbor.id, amount: fire });
  }
  // 按座位顺序（从攻击者下家起）
  const order = orderFrom(s, source).map((player) => player.id);
  return out.sort((a, b) => order.indexOf(a.target) - order.indexOf(b.target));
}

/** 能不能让位：在城心 / 港湾里，被城外的当前玩家的爪打到。 */
function canYield(s: GameState, target: Player, attacker: Player): boolean {
  return target.alive && target.location !== null && attacker.location === null && attacker.alive;
}

// ---------------------------------------------------------------- 结算队列

function runQueue(ctx: Ctx): void {
  const { s } = ctx;
  let guard = 0;
  while (s.phase === "playing" && !s.prompt && s.queue.length > 0) {
    guard += 1;
    if (guard > 1000) throw new Error("结算队列卡住了。");
    const task = s.queue[0]!;
    switch (task.t) {
      case "damage":
        runDamage(ctx, task);
        break;
      case "afterBatch":
        s.queue.shift();
        afterBatch(ctx);
        break;
      case "askYield":
        runAskYield(ctx, task);
        break;
      case "enter":
        s.queue.shift();
        runEnter(ctx);
        break;
      case "toBuy":
        s.queue.shift();
        s.stage = "buy";
        break;
      case "endTurn":
        s.queue.shift();
        runEndTurn(ctx);
        break;
    }
  }
  if (s.phase === "playing" && !s.prompt && s.stage === "prompt") throw new Error("结算后没有下一步。");
}

function runDamage(ctx: Ctx, task: Extract<Task, { t: "damage" }>): void {
  const { s } = ctx;
  const hits = [...task.hits];
  const source = s.players.find((player) => player.id === task.source);
  while (hits.length > 0) {
    const hit = hits[0]!;
    const target = playerById(s, hit.target);
    if (!target.alive || hit.amount <= 0) {
      hits.shift();
      continue;
    }
    // 喷气式：先问让位（让位就不吃这次伤害）
    if (task.attack && !hit.jetsAsked && source && canYield(s, target, source) && hasCard(s, target, "jets")) {
      hits[0] = { ...hit, jetsAsked: true };
      s.queue[0] = { ...task, hits };
      setPrompt(s, { kind: "yield", player: target.id, attacker: source.id, spot: target.location!, damage: hit.amount, jetsBefore: true });
      return;
    }
    // 双翼：挨打前问要不要用
    const armorBlocks = hit.amount === 1 && hasCard(s, target, "armor-plating");
    if (!hit.wingsAsked && !target.wingsActive && !armorBlocks && target.energy >= 2 && hasCard(s, target, "wings")) {
      hits[0] = { ...hit, wingsAsked: true };
      s.queue[0] = { ...task, hits };
      setPrompt(s, { kind: "wings", player: target.id, source: task.source, damage: hit.amount });
      return;
    }
    hits.shift();
    applyDamage(ctx, task.source, target, hit.amount, task.attack);
  }
  s.queue.shift();
}

function setPrompt(s: GameState, prompt: NonNullable<GameState["prompt"]>): void {
  s.prompt = prompt;
  s.stage = "prompt";
}

function runAskYield(ctx: Ctx, task: Extract<Task, { t: "askYield" }>): void {
  const { s } = ctx;
  const attacker = currentPlayer(s);
  const rest = [...task.targets];
  while (rest.length > 0) {
    const entry = rest.shift()!;
    const target = playerById(s, entry.player);
    if (!canYield(s, target, attacker) || (s.turnState.attackDamage[target.id] ?? 0) <= 0) continue;
    s.queue[0] = { t: "askYield", targets: rest };
    setPrompt(s, { kind: "yield", player: target.id, attacker: attacker.id, spot: target.location!, damage: s.turnState.attackDamage[target.id]! });
    return;
  }
  s.queue.shift();
}

/** 一批伤害之后：港湾关闭、只剩一只或全倒、当前玩家倒了就结束这回合。 */
function afterBatch(ctx: Ctx): void {
  const { s } = ctx;
  const alive = alivePlayers(s);
  if (s.bayOpen && alive.length <= 4) {
    s.bayOpen = false;
    emit(ctx, { type: "BayClosed" });
    if (s.bay) {
      const occupant = playerById(s, s.bay);
      if (!s.city) enterSpot(ctx, occupant, "city", "bayClosed");
      else {
        leaveSpot(s, occupant);
        emit(ctx, { type: "Left", player: occupant.id, spot: "bay", reason: "bayClosed" });
      }
    }
  }
  if (alive.length === 0) {
    finish(ctx, [], "allDead");
    return;
  }
  if (alive.length === 1) {
    finish(ctx, [alive[0]!.id], "lastStanding");
    return;
  }
  if (!currentPlayer(s).alive) s.queue = [{ t: "endTurn" }];
}

function finish(ctx: Ctx, winners: string[], reason: "vp" | "lastStanding" | "allDead"): void {
  const { s } = ctx;
  s.phase = "finished";
  s.finalResult = { winners, reason };
  s.queue = [];
  delete s.prompt;
  emit(ctx, { type: "GameEnded", winners, reason });
}

/** 结算完骰子（和让位）后：城心空着就必须进去；城心有人、港湾开着且空着就进港湾。 */
function runEnter(ctx: Ctx): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  if (!player.alive || player.location) return;
  let spot: Spot | null = null;
  if (!s.city) spot = "city";
  else if (s.bayOpen && !s.bay) spot = "bay";
  if (!spot) return;
  enterSpot(ctx, player, spot);
  // 钻地：让位的怪兽给接替它的怪兽 1 伤害
  const vacater = s.turnState.vacated[spot];
  if (vacater) {
    const burrower = playerById(s, vacater);
    const burrow = burrower.alive ? cardCount(s, burrower, "burrowing") : 0;
    if (burrow > 0) s.queue.unshift({ t: "damage", source: burrower.id, hits: [{ target: player.id, amount: burrow }], attack: false }, { t: "afterBatch" });
  }
}

// ---------------------------------------------------------------- 回合

/** 新回合的回合状态（预览工厂也用）。 */
export function freshTurn(s: GameState, player: Player, freezeStack: number): TurnState {
  const count = diceCountFor(s, player, freezeStack);
  const dice: Die[] = [];
  for (let i = 0; i < count; i += 1) dice.push({ face: null, green: i >= BASE_DICE });
  return {
    player: player.id,
    dice,
    rollsLeft: BASE_ROLLS + cardCount(s, player, "giant-brain"),
    rolls: 0,
    herdCullerUsed: false,
    resolved: false,
    dealtDamage: false,
    scoredOnes: false,
    metamorphEnergy: 0,
    freezeStack,
    vacated: {},
    attackDamage: {},
    dwellerRerolls: 0,
  };
}

function startTurn(ctx: Ctx, index: number, extra?: "frenzy" | "freeze"): void {
  const { s } = ctx;
  const previousStack = s.turnState?.freezeStack ?? 0;
  s.currentPlayer = index;
  const player = currentPlayer(s);
  for (const other of s.players) delete other.wingsActive;
  s.stage = "roll";
  s.queue = [];
  delete s.prompt;
  emit(ctx, extra ? { type: "TurnStarted", player: player.id, extra } : { type: "TurnStarted", player: player.id });
  // 回合开始还在城里：+2 分（2 人局 +1 能量）；城市吞噬者 +1 分
  if (player.location) {
    if (twoPlayer(s)) gainEnergy(ctx, player, 1, "startInCity");
    else gainVp(ctx, player, 2, "startInCity");
    gainVp(ctx, player, cardCount(s, player, "urbavore"), "urbavore");
  }
  // 怪兽电池：取 2 能量，取空弃卡
  for (const card of [...player.cards]) {
    if (card.id !== "monster-batteries") continue;
    const take = Math.min(2, card.battery ?? 0);
    if (take > 0) {
      card.battery = (card.battery ?? 0) - take;
      player.energy += take;
      emit(ctx, { type: "Energy", player: player.id, amount: take, reason: "battery" });
    }
    if ((card.battery ?? 0) <= 0) removeCard(ctx, player, card.uid, "empty");
  }
  s.turnState = freshTurn(s, player, extra === "freeze" ? previousStack + 1 : 0);
  // 一颗骰子都没有（缩小标记太多）：直接结算
  if (s.turnState.dice.length === 0) resolveDice(ctx);
}

function nextAliveIndex(s: GameState, from: number): number {
  const n = s.players.length;
  for (let offset = 1; offset <= n; offset += 1) {
    const index = (from + offset) % n;
    if (s.players[index]!.alive) return index;
  }
  return from;
}

/** 回合结束：中毒扣血 → 草食动物、能量囤积者、为弱者加油、太阳能、变形到账 → 冻结时间 → 胜负 → 下一回合。 */
function runEndTurn(ctx: Ctx): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  const ts = s.turnState;
  if (player.alive && player.poison > 0) {
    player.life -= player.poison;
    emit(ctx, { type: "LifeLost", player: player.id, amount: player.poison, reason: "poison" });
    if (player.life <= 0) knockOut(ctx, player, null);
    afterBatch(ctx);
    if (s.phase === "finished") return;
    s.queue = [];
  }
  if (player.alive) {
    if (!ts.dealtDamage) gainVp(ctx, player, cardCount(s, player, "herbivore"), "herbivore");
    gainVp(ctx, player, Math.floor(player.energy / 6) * cardCount(s, player, "energy-hoarder"), "hoarder");
    const underdog = cardCount(s, player, "rooting-for-the-underdog");
    if (underdog > 0 && alivePlayers(s).every((other) => other.vp >= player.vp)) gainVp(ctx, player, underdog, "underdog");
    if (player.energy === 0) gainEnergy(ctx, player, cardCount(s, player, "solar-powered"), "solar");
    if (ts.metamorphEnergy > 0) {
      player.energy += ts.metamorphEnergy;
      emit(ctx, { type: "Energy", player: player.id, amount: ts.metamorphEnergy, reason: "metamorph" });
    }
    if (ts.scoredOnes && hasCard(s, player, "freeze-time")) s.extraTurns.push("freeze");
  }
  for (const other of s.players) delete other.wingsActive;
  const winners = alivePlayers(s).filter((other) => other.vp >= s.config.winVp);
  if (winners.length > 0) {
    finish(ctx, winners.map((winner) => winner.id), "vp");
    return;
  }
  s.turn += 1;
  if (player.alive && s.extraTurns.length > 0) {
    const extra = s.extraTurns.shift()!;
    startTurn(ctx, s.currentPlayer, extra);
    return;
  }
  s.extraTurns = [];
  startTurn(ctx, nextAliveIndex(s, s.currentPlayer));
}

// ---------------------------------------------------------------- 掷骰

function rollFace(rng: Rng): Face {
  return FACES[rng.int(6)]!;
}

/** 重掷次数用完后还有没有办法再掷或改骰（没有就自动结算）。 */
function hasDiceOptions(s: GameState): boolean {
  const player = currentPlayer(s);
  const ts = s.turnState;
  if (ts.rollsLeft > 0) return true;
  if (hasCard(s, player, "background-dweller") && ts.dwellerRerolls < DWELLER_LIMIT && ts.dice.some((die) => die.face === "3")) return true;
  if (player.cards.some((card) => card.id === "smoke-cloud" && (card.smoke ?? 0) > 0)) return true;
  if (hasCard(s, player, "telepath") && player.energy >= 1) return true;
  if (hasCard(s, player, "herd-culler") && !ts.herdCullerUsed && ts.dice.some((die) => die.face !== "1")) return true;
  if (player.cards.some((card) => card.id === "plot-twist")) return true;
  if (hasCard(s, player, "stretchy") && player.energy >= 2) return true;
  return false;
}

function applyRoll(ctx: Ctx, command: Extract<GameCommand, { type: "ROLL" }>): void {
  const { s, rng } = ctx;
  const player = currentPlayer(s);
  const ts = s.turnState;
  if (ts.resolved) throw new Error("骰子已经结算了。");
  if (ts.dice.length === 0) throw new Error("没有骰子可掷。");
  if (ts.rolls === 0) {
    for (const die of ts.dice) die.face = rollFace(rng);
    ts.rolls = 1;
    ts.rollsLeft -= 1;
    emit(ctx, { type: "Rolled", player: player.id, dice: ts.dice.map((die) => die.face), rerolled: ts.dice.map((_, i) => i) });
  } else {
    const keep = new Set(command.keep ?? []);
    for (const index of keep) {
      if (!Number.isInteger(index) || index < 0 || index >= ts.dice.length) throw new Error("没有这颗骰子。");
    }
    const reroll = ts.dice.map((_, i) => i).filter((i) => !keep.has(i));
    if (reroll.length === 0) throw new Error("至少要重掷一颗骰子。");
    const onlyThrees = reroll.every((i) => ts.dice[i]!.face === "3");
    let use: "smoke" | "telepath" | "dweller" | undefined;
    if (onlyThrees && hasCard(s, player, "background-dweller") && ts.dwellerRerolls < DWELLER_LIMIT && (ts.rollsLeft <= 0 || !command.use)) {
      use = "dweller";
      ts.dwellerRerolls += 1;
    } else if (ts.rollsLeft > 0) {
      ts.rollsLeft -= 1;
    } else if (command.use === "smoke") {
      const smoke = player.cards.find((card) => card.id === "smoke-cloud" && (card.smoke ?? 0) > 0);
      if (!smoke) throw new Error("没有烟雾标记了。");
      smoke.smoke = (smoke.smoke ?? 0) - 1;
      use = "smoke";
      if (smoke.smoke <= 0) removeCard(ctx, player, smoke.uid, "used");
    } else if (command.use === "telepath") {
      if (!hasCard(s, player, "telepath")) throw new Error("你没有心灵感应。");
      if (player.energy < 1) throw new Error("能量不够。");
      player.energy -= 1;
      use = "telepath";
    } else {
      throw new Error("没有重掷次数了。");
    }
    for (const i of reroll) ts.dice[i]!.face = rollFace(rng);
    ts.rolls += 1;
    emit(ctx, use
      ? { type: "Rolled", player: player.id, dice: ts.dice.map((die) => die.face), rerolled: reroll, use }
      : { type: "Rolled", player: player.id, dice: ts.dice.map((die) => die.face), rerolled: reroll });
  }
  if (!hasDiceOptions(s)) resolveDice(ctx);
}

function applyChangeDie(ctx: Ctx, command: Extract<GameCommand, { type: "CHANGE_DIE" }>): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  const ts = s.turnState;
  if (ts.resolved || ts.rolls === 0) throw new Error("现在不能改骰子。");
  const die = ts.dice[command.index];
  if (!die) throw new Error("没有这颗骰子。");
  if (!FACES.includes(command.face)) throw new Error("没有这种骰面。");
  switch (command.via) {
    case "herd-culler":
      if (!hasCard(s, player, "herd-culler")) throw new Error("你没有剔除弱者。");
      if (ts.herdCullerUsed) throw new Error("剔除弱者这回合用过了。");
      if (command.face !== "1") throw new Error("剔除弱者只能改成 1。");
      ts.herdCullerUsed = true;
      break;
    case "plot-twist": {
      const card = player.cards.find((candidate) => candidate.id === "plot-twist");
      if (!card) throw new Error("你没有剧情反转。");
      removeCard(ctx, player, card.uid, "used");
      break;
    }
    case "stretchy":
      if (!hasCard(s, player, "stretchy")) throw new Error("你没有弹性。");
      if (player.energy < 2) throw new Error("能量不够。");
      player.energy -= 2;
      break;
    default:
      throw new Error("不能这样改骰子。");
  }
  die.face = command.face;
  emit(ctx, { type: "DieChanged", player: player.id, index: command.index, face: command.face, via: command.via });
  if (!hasDiceOptions(s)) resolveDice(ctx);
}

/** 结算骰子：数字 → 能量 → 心 → 爪，然后让位、进城、买牌。 */
function resolveDice(ctx: Ctx): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  const ts = s.turnState;
  ts.resolved = true;
  const faces = ts.dice.map((die) => die.face).filter((face): face is Face => face !== null);
  emit(ctx, { type: "Resolved", player: player.id, dice: faces });
  const count = (face: Face) => faces.filter((candidate) => candidate === face).length;

  // 数字
  const diceVp = scoreDice(faces);
  gainVp(ctx, player, diceVp, "dice");
  let quills = 0;
  if (count("1") >= 3) {
    ts.scoredOnes = true;
    gainVp(ctx, player, 2 * cardCount(s, player, "gourmet"), "gourmet");
  }
  if (count("2") >= 3) quills = 2 * cardCount(s, player, "poison-quills");
  if (count("1") >= 1 && count("2") >= 1 && count("3") >= 1) gainVp(ctx, player, 2 * cardCount(s, player, "omnivore"), "omnivore");
  if (FACES.every((face) => count(face) >= 1)) gainVp(ctx, player, 9 * cardCount(s, player, "complete-destruction"), "destruction");

  // 能量
  gainEnergy(ctx, player, count("energy"), "dice");

  // 心：在城里没用；在城外先去中毒、缩小标记，剩下的回血
  let hearts = count("heart");
  if (hearts > 0 && !player.location) {
    const poison = Math.min(hearts, player.poison);
    if (poison > 0) {
      player.poison -= poison;
      hearts -= poison;
      emit(ctx, { type: "TokenRemoved", player: player.id, token: "poison", count: poison });
    }
    const shrink = Math.min(hearts, player.shrink);
    if (shrink > 0) {
      player.shrink -= shrink;
      hearts -= shrink;
      emit(ctx, { type: "TokenRemoved", player: player.id, token: "shrink", count: shrink });
    }
    heal(ctx, player, hearts, "dice");
  }

  // 爪（加上酸液攻击、毒刺）
  const base = count("claw") + cardCount(s, player, "acid-attack") + quills;
  const targets = clawTargets(s, player);
  ts.attackDamage = {};
  const tasks: Task[] = [];
  if (base > 0 && targets.length > 0) {
    const damage = base
      + cardCount(s, player, "spiked-tail")
      + (player.location ? cardCount(s, player, "burrowing") + cardCount(s, player, "urbavore") : 0);
    emit(ctx, { type: "Attack", player: player.id, damage, targets: targets.map((target) => target.id) });
    gainVp(ctx, player, cardCount(s, player, "alpha-monster"), "alpha");
    const hits = addFireBreathing(s, player, targets.map((target) => ({ target: target.id, amount: damage })));
    tasks.push({ t: "damage", source: player.id, hits, attack: true }, { t: "afterBatch" });
    // 挨了爪的城心、港湾怪兽依次选让位（城心先问）；有喷气式的在挨打前已经问过
    const yielders = targets
      .filter((target) => canYield(s, target, player) && !hasCard(s, target, "jets"))
      .sort((a, b) => (a.location === "city" ? 0 : 1) - (b.location === "city" ? 0 : 1))
      .map((target) => ({ player: target.id, damage }));
    if (yielders.length > 0) tasks.push({ t: "askYield", targets: yielders });
  }
  tasks.push({ t: "enter" }, { t: "toBuy" });
  s.queue.push(...tasks);
}

// ---------------------------------------------------------------- 买牌

export function cardPrice(state: GameState, buyer: Player, id: CardId): number {
  return Math.max(0, CARDS[id].cost - cardCount(state, buyer, "alien-metabolism"));
}

/** 能被模仿的卡：场上活着的怪兽面前的 KEEP 卡，除了模仿自己和带消耗状态的卡。 */
export function mimicTargets(state: GameState): CardInstance[] {
  return state.players
    .filter((player) => player.alive)
    .flatMap((player) => player.cards)
    .filter((card) => !UNMIMICABLE.includes(card.id));
}

function applyBuy(ctx: Ctx, command: Extract<GameCommand, { type: "BUY" }>): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  const uid = command.uid;
  let source: "market" | "deck" | Player;
  let card: CardInstance;
  const slot = s.market.findIndex((candidate) => candidate?.uid === uid);
  if (slot >= 0) {
    source = "market";
    card = s.market[slot]!;
  } else if (s.deck[0]?.uid === uid && hasCard(s, player, "made-in-a-lab")) {
    source = "deck";
    card = s.deck[0];
  } else {
    const owned = findOwnedCard(s, uid);
    if (!owned || owned.owner.id === player.id || !owned.owner.alive || !hasCard(s, player, "parasitic-tentacles")) {
      throw new Error("买不到这张卡。");
    }
    source = owned.owner;
    card = owned.card;
  }
  const def = CARDS[card.id];
  const price = cardPrice(s, player, card.id);
  if (player.energy < price) throw new Error("能量不够。");
  // 专属新闻组：之后每买一张 +1（不算刚买的这张）
  const news = cardCount(s, player, "dedicated-news-team");
  player.energy -= price;
  let bought: CardInstance;
  if (source === "market") {
    s.market[slot] = s.deck.shift() ?? null;
    bought = { uid: card.uid, id: card.id };
  } else if (source === "deck") {
    s.deck.shift();
    bought = { uid: card.uid, id: card.id };
  } else {
    source.energy += price;
    bought = removeCard(ctx, source, uid, "stolen", false);
    delete bought.mimic;
  }
  s.deckCount = s.deck.length;
  emit(ctx, { type: "Bought", player: player.id, card: card.id, cost: price, from: typeof source === "string" ? source : source.id });
  gainVp(ctx, player, news, "news");

  if (def.kind === "keep") {
    player.cards.push(bought);
    if (typeof source === "string") {
      if (card.id === "smoke-cloud") bought.smoke = 3;
      if (card.id === "monster-batteries") {
        const amount = Math.max(0, Math.min(player.energy, Math.floor(command.batteryEnergy ?? 0)));
        player.energy -= amount;
        bought.battery = amount * 2;
      }
      if (card.id === "even-bigger") heal(ctx, player, 2, "card");
    }
    if (card.id === "mimic" && command.mimicTarget) setMimic(ctx, player, bought, command.mimicTarget);
    if (card.id === "monster-batteries" && (bought.battery ?? 0) <= 0 && typeof source === "string") {
      // 一点能量都没存：下回合开始就会弃掉，这里不提前处理
    }
    return;
  }
  s.discard.push(bought);
  applyDiscardEffect(ctx, player, card.id);
}

function setMimic(ctx: Ctx, player: Player, mimic: CardInstance, targetUid: string): void {
  const { s } = ctx;
  const target = findOwnedCard(s, targetUid);
  if (!target || !target.owner.alive || UNMIMICABLE.includes(target.card.id)) throw new Error("不能模仿这张卡。");
  mimic.mimic = targetUid;
  emit(ctx, { type: "MimicSet", player: player.id, card: target.card.id, owner: target.owner.id });
  clampLives(ctx);
}

function applyDiscardEffect(ctx: Ctx, player: Player, id: CardId): void {
  const { s } = ctx;
  const others = orderFrom(s, player).filter((other) => other.alive && other.id !== player.id);
  const damage = (targets: Player[], amount: number) => {
    s.queue.push({ t: "damage", source: player.id, hits: cardHits(ctx, player, targets, amount), attack: false }, { t: "afterBatch" }, { t: "toBuy" });
  };
  switch (id) {
    case "apartment-building":
      gainVp(ctx, player, 3, "card", id);
      break;
    case "commuter-train":
      gainVp(ctx, player, 2, "card", id);
      break;
    case "corner-store":
      gainVp(ctx, player, 1, "card", id);
      break;
    case "skyscraper":
      gainVp(ctx, player, 4, "card", id);
      break;
    case "drop-from-high-altitude":
      gainVp(ctx, player, 2, "card", id);
      if (player.location !== "city") {
        if (s.city) {
          const pushed = playerById(s, s.city);
          leaveSpot(s, pushed);
          emit(ctx, { type: "Left", player: pushed.id, spot: "city", reason: "pushed" });
        }
        enterSpot(ctx, player, "city", "drop");
      }
      break;
    case "energize":
      gainEnergy(ctx, player, 9, "card");
      break;
    case "evacuation-orders":
      for (const other of others) {
        const lost = Math.min(5, other.vp);
        if (lost > 0) {
          other.vp -= lost;
          emit(ctx, { type: "VpLost", player: other.id, amount: lost, reason: id });
        }
      }
      break;
    case "fire-blast":
      damage(others, 2);
      break;
    case "frenzy":
      s.extraTurns.unshift("frenzy");
      break;
    case "gas-refinery":
      gainVp(ctx, player, 2, "card", id);
      damage(others, 3);
      break;
    case "heal":
      heal(ctx, player, 2, "card");
      break;
    case "high-altitude-bombing":
      damage([...others, player], 3);
      break;
    case "jet-fighters":
      gainVp(ctx, player, 5, "card", id);
      damage([player], 4);
      break;
    case "national-guard":
      gainVp(ctx, player, 2, "card", id);
      damage([player], 2);
      break;
    case "tanks":
      gainVp(ctx, player, 4, "card", id);
      damage([player], 3);
      break;
    case "nuclear-power-plant":
      gainVp(ctx, player, 2, "card", id);
      heal(ctx, player, 3, "card");
      break;
    case "vast-storm":
      gainVp(ctx, player, 2, "card", id);
      for (const other of others) {
        const lost = Math.floor(other.energy / 2);
        if (lost > 0) {
          other.energy -= lost;
          emit(ctx, { type: "EnergyLost", player: other.id, amount: lost, reason: id });
        }
      }
      break;
    default:
      throw new Error(`这张卡不是一次性卡：${id}`);
  }
}

function applySweep(ctx: Ctx): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  if (player.energy < 2) throw new Error("扫牌要 2 能量。");
  player.energy -= 2;
  const discarded: CardId[] = [];
  for (let slot = 0; slot < s.market.length; slot += 1) {
    const card = s.market[slot];
    if (card) {
      s.discard.push(card);
      discarded.push(card.id);
    }
    s.market[slot] = null;
  }
  refillMarket(s);
  emit(ctx, { type: "Swept", player: player.id, discarded });
}

function applySell(ctx: Ctx, uid: string): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  if (!hasCard(s, player, "metamorph")) throw new Error("你没有变形。");
  const card = player.cards.find((candidate) => candidate.uid === uid);
  if (!card) throw new Error("没有这张卡。");
  const energy = CARDS[card.id].cost;
  removeCard(ctx, player, uid, "sold");
  s.turnState.metamorphEnergy += energy;
  emit(ctx, { type: "Sold", player: player.id, card: card.id, energy });
}

function applyMimic(ctx: Ctx, targetUid: string): void {
  const { s } = ctx;
  const player = currentPlayer(s);
  if (s.turnState.rolls > 0) throw new Error("只能在第一次掷骰前换模仿目标。");
  const mimic = player.cards.find((card) => card.id === "mimic");
  if (!mimic) throw new Error("你没有模仿。");
  if (mimic.mimic === targetUid) throw new Error("已经在模仿这张卡了。");
  if (player.energy < 1) throw new Error("换模仿目标要 1 能量。");
  player.energy -= 1;
  setMimic(ctx, player, mimic, targetUid);
}

function applyRapidHeal(ctx: Ctx, playerId: string): void {
  const { s } = ctx;
  const player = playerById(s, playerId);
  if (!player.alive) throw new Error("你已经出局了。");
  if (!hasCard(s, player, "rapid-healing")) throw new Error("你没有快速治疗。");
  if (player.energy < 2) throw new Error("快速治疗要 2 能量。");
  if (player.life >= maxLifeOf(s, player)) throw new Error("生命已经满了。");
  player.energy -= 2;
  heal(ctx, player, 1, "rapid-healing");
}

// ---------------------------------------------------------------- 入口

export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("对局已经结束。");
  const s = structuredClone(state);
  const ctx: Ctx = { s, rng, ev: [] };
  if (command?.type === "RAPID_HEAL") {
    applyRapidHeal(ctx, playerId);
  } else {
    if (actorId(s) !== playerId) throw new Error("还没轮到你。");
    const prompt = s.prompt;
    switch (command?.type) {
      case "ROLL":
      case "CHANGE_DIE":
      case "RESOLVE":
      case "MIMIC":
        if (s.stage !== "roll") throw new Error("现在不是掷骰的时候。");
        if (command.type === "ROLL") applyRoll(ctx, command);
        else if (command.type === "CHANGE_DIE") applyChangeDie(ctx, command);
        else if (command.type === "MIMIC") applyMimic(ctx, command.target);
        else {
          if (s.turnState.rolls === 0 && s.turnState.dice.length > 0) throw new Error("先掷骰子。");
          if (s.turnState.resolved) throw new Error("骰子已经结算了。");
          resolveDice(ctx);
        }
        break;
      case "YIELD": {
        if (prompt?.kind !== "yield") throw new Error("现在不用选让位。");
        const target = playerById(s, prompt.player);
        delete s.prompt;
        if (command.yield) {
          const spot = leaveSpot(s, target)!;
          s.turnState.vacated[spot] = target.id;
          emit(ctx, { type: "Yielded", player: target.id, spot, to: prompt.attacker });
          if (prompt.jetsBefore) {
            // 喷气式：这次伤害不吃
            const head = s.queue[0];
            if (head?.t === "damage") s.queue[0] = { ...head, hits: head.hits.filter((hit) => hit.target !== target.id) };
          }
        } else {
          emit(ctx, { type: "Stayed", player: target.id, spot: prompt.spot });
        }
        break;
      }
      case "WINGS": {
        if (prompt?.kind !== "wings") throw new Error("现在不用选双翼。");
        const target = playerById(s, prompt.player);
        delete s.prompt;
        if (command.use) {
          if (target.energy < 2) throw new Error("能量不够。");
          target.energy -= 2;
          target.wingsActive = true;
          emit(ctx, { type: "WingsUsed", player: target.id });
        }
        break;
      }
      case "BUY":
      case "SWEEP":
      case "SELL":
      case "END_TURN":
        if (s.stage !== "buy") throw new Error("现在不是买牌的时候。");
        if (command.type === "BUY") applyBuy(ctx, command);
        else if (command.type === "SWEEP") applySweep(ctx);
        else if (command.type === "SELL") applySell(ctx, command.uid);
        else s.queue.push({ t: "endTurn" });
        break;
      default:
        throw new Error("未知的行动。");
    }
    runQueue(ctx);
    s.step += 1;
  }
  s.deckCount = s.deck.length;
  s.version += 1;
  s.events = ctx.ev;
  s.recent = [...s.recent, ...ctx.ev.map((e) => ({ v: s.version, e }))].slice(-RECENT_LIMIT);
  return { state: s, events: ctx.ev };
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const { state: next, events } = apply(state, playerId, command, rng);
  next.rngState = rng.state;
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return { state: next, events };
}

export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/** 这一步的限时（毫秒）。 */
export function stepTimeoutMs(state: GameState): number {
  const c = state.config;
  if (state.prompt?.kind === "yield") return c.yieldTimeoutSec * 1000;
  if (state.prompt?.kind === "wings") return c.reactTimeoutSec * 1000;
  if (state.stage === "buy") return c.buyTimeoutSec * 1000;
  return c.rollTimeoutSec * 1000;
}

/**
 * 当前这一步超时：
 * - 掷骰：还没掷就掷一次，然后不重掷直接结算；
 * - 让位：留下；双翼：不用；
 * - 买牌：直接结束回合。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const actor = actorId(state);
  const prompt = state.prompt;
  const stage = prompt ? prompt.kind : state.stage;
  const events: GameEvent[] = [];
  let current = state;
  const run = (command: GameCommand) => {
    const step = runCommand(current, actor, command);
    events.push(...step.events);
    current = step.state;
  };
  if (prompt?.kind === "yield") run({ type: "YIELD", yield: false });
  else if (prompt?.kind === "wings") run({ type: "WINGS", use: false });
  else if (state.stage === "buy") run({ type: "END_TURN" });
  else {
    if (state.turnState.rolls === 0 && state.turnState.dice.length > 0) run({ type: "ROLL" });
    if (current.stage === "roll" && !current.turnState.resolved && current.turnState.player === actor) run({ type: "RESOLVE" });
  }
  const timedOut: GameEvent = { type: "TurnTimedOut", player: actor, stage };
  current.events = [timedOut, ...events];
  current.recent = [...current.recent, { v: current.version, e: timedOut }].slice(-RECENT_LIMIT);
  return current;
}

/**
 * 当前能做的动作（给测试和简单人机用）。掷骰的留骰组合只列几种代表：全部重掷、每次只留一种面。
 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase === "finished") return [];
  const out: GameCommand[] = [];
  const me = state.players.find((player) => player.id === playerId);
  if (me?.alive && hasCard(state, me, "rapid-healing") && me.energy >= 2 && me.life < maxLifeOf(state, me)) out.push({ type: "RAPID_HEAL" });
  if (actorId(state) !== playerId) return out;
  const prompt = state.prompt;
  if (prompt?.kind === "yield") return [...out, { type: "YIELD", yield: true }, { type: "YIELD", yield: false }];
  if (prompt?.kind === "wings") {
    const options: GameCommand[] = [{ type: "WINGS", use: false }];
    if ((me?.energy ?? 0) >= 2) options.push({ type: "WINGS", use: true });
    return [...out, ...options];
  }
  const player = currentPlayer(state);
  const ts = state.turnState;
  if (state.stage === "roll") {
    if (ts.rolls === 0) {
      out.push(ts.dice.length > 0 ? { type: "ROLL" } : { type: "RESOLVE" });
      const mimic = player.cards.find((card) => card.id === "mimic");
      if (mimic && player.energy >= 1) {
        for (const target of mimicTargets(state)) if (target.uid !== mimic.mimic) out.push({ type: "MIMIC", target: target.uid });
      }
      return out;
    }
    out.push({ type: "RESOLVE" });
    const canRoll = ts.rollsLeft > 0;
    const smoke = player.cards.some((card) => card.id === "smoke-cloud" && (card.smoke ?? 0) > 0);
    const telepath = hasCard(state, player, "telepath") && player.energy >= 1;
    const keepSets: number[][] = [[]];
    for (const face of FACES) {
      const keep = ts.dice.map((die, i) => (die.face === face ? i : -1)).filter((i) => i >= 0);
      if (keep.length > 0 && keep.length < ts.dice.length) keepSets.push(keep);
    }
    for (const keep of keepSets) {
      if (canRoll) out.push({ type: "ROLL", keep });
      else {
        if (smoke) out.push({ type: "ROLL", keep, use: "smoke" });
        if (telepath) out.push({ type: "ROLL", keep, use: "telepath" });
      }
    }
    if (hasCard(state, player, "background-dweller") && ts.dwellerRerolls < DWELLER_LIMIT && ts.dice.some((die) => die.face === "3")) {
      out.push({ type: "ROLL", keep: ts.dice.map((die, i) => (die.face === "3" ? -1 : i)).filter((i) => i >= 0) });
    }
    ts.dice.forEach((die, index) => {
      if (hasCard(state, player, "herd-culler") && !ts.herdCullerUsed && die.face !== "1") out.push({ type: "CHANGE_DIE", index, face: "1", via: "herd-culler" });
      if (player.cards.some((card) => card.id === "plot-twist") && die.face !== "3") out.push({ type: "CHANGE_DIE", index, face: "3", via: "plot-twist" });
      if (hasCard(state, player, "stretchy") && player.energy >= 2 && die.face !== "claw") out.push({ type: "CHANGE_DIE", index, face: "claw", via: "stretchy" });
    });
    return out;
  }
  // buy
  out.push({ type: "END_TURN" });
  if (player.energy >= 2) out.push({ type: "SWEEP" });
  const buyable: CardInstance[] = state.market.filter((card): card is CardInstance => card !== null);
  if (hasCard(state, player, "made-in-a-lab") && state.deck[0]) buyable.push(state.deck[0]);
  if (state.peek) buyable.push(state.peek);
  if (hasCard(state, player, "parasitic-tentacles")) {
    for (const other of state.players) if (other.id !== player.id && other.alive) buyable.push(...other.cards);
  }
  const seen = new Set<string>();
  for (const card of buyable) {
    if (seen.has(card.uid)) continue;
    seen.add(card.uid);
    if (cardPrice(state, player, card.id) > player.energy) continue;
    if (card.id === "mimic") {
      const target = mimicTargets(state).find((candidate) => candidate.uid !== card.uid);
      out.push(target ? { type: "BUY", uid: card.uid, mimicTarget: target.uid } : { type: "BUY", uid: card.uid });
    } else if (card.id === "monster-batteries") {
      out.push({ type: "BUY", uid: card.uid, batteryEnergy: Math.max(0, player.energy - cardPrice(state, player, card.id)) });
    } else out.push({ type: "BUY", uid: card.uid });
  }
  if (hasCard(state, player, "metamorph")) for (const card of player.cards) out.push({ type: "SELL", uid: card.uid });
  return out;
}

/** 牌堆顺序、种子、动作序列不下发；实验室出品的主人在自己买牌时能看到牌堆顶一张。 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const { seed: _seed, rngState: _rngState, log: _log, peek: _peek, ...rest } = state;
  const redacted: GameState = { ...rest, deck: [], deckCount: state.deck.length };
  if (state.phase === "playing" && state.stage === "buy" && viewerId) {
    const player = currentPlayer(state);
    if (player.id === viewerId && hasCard(state, player, "made-in-a-lab") && state.deck[0]) redacted.peek = { ...state.deck[0] };
  }
  return redacted;
}

export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  overrides: Partial<Config> = {},
): GameState {
  const config = defaultConfig(players.length, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  // 怪兽：选了且没撞的照选，其余从剩下的随机分
  const taken = new Set<MonsterId>();
  const chosen = players.map((player) => {
    if (player.monster && MONSTER_IDS.includes(player.monster) && !taken.has(player.monster)) {
      taken.add(player.monster);
      return player.monster;
    }
    return null;
  });
  const free = rng.shuffle(MONSTER_IDS.filter((id) => !taken.has(id)));
  const monsters = chosen.map((monster) => monster ?? free.shift()!);
  const deck: CardInstance[] = rng.shuffle(fullDeck());
  const market = [deck.shift() ?? null, deck.shift() ?? null, deck.shift() ?? null];
  const startPlayer = rng.int(players.length);
  const s: GameState = {
    config,
    phase: "playing",
    players: players.map((player, seat) => ({
      id: player.id,
      name: player.name,
      seat,
      monster: monsters[seat]!,
      life: config.maxLife,
      vp: 0,
      energy: 0,
      alive: true,
      location: null,
      cards: [],
      poison: 0,
      shrink: 0,
    })),
    currentPlayer: startPlayer,
    turn: 1,
    step: 0,
    stage: "roll",
    turnState: undefined as unknown as TurnState,
    queue: [],
    city: null,
    bay: null,
    bayOpen: players.length >= 5,
    market,
    deck,
    deckCount: deck.length,
    discard: [],
    extraTurns: [],
    events: [],
    recent: [],
    version: 0,
    seed,
  };
  const ctx: Ctx = { s, rng, ev: [] };
  startTurn(ctx, startPlayer);
  s.events = ctx.ev;
  s.recent = ctx.ev.map((e) => ({ v: 0, e }));
  s.rngState = rng.state;
  return s;
}
