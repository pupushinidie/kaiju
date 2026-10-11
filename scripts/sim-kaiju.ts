// 巨兽之城人机强度：人机 vs 基线 A（随机）、基线 B（爪和心优先、凑够就买最便宜、血 ≤5 让位），以及全人机自对弈。
// 用法：cd ~/projects/kaiju && npx tsx scripts/sim-kaiju.ts [局数，默认 300]
import {
  actorId, applyCommand, botCommand, cardPrice, createGame, currentPlayer, legalActions, redactGameForViewer,
  type GameCommand, type GameState,
} from "../packages/game/src/index.ts";

type Bot = (s: GameState, id: string) => GameCommand;
let r = 777;
const rand = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)]!;

const randomBot: Bot = (s, id) => {
  if (s.prompt?.kind === "yield") return { type: "YIELD", yield: false };
  if (s.prompt?.kind === "wings") return { type: "WINGS", use: false };
  const ts = s.turnState;
  if (s.stage === "roll") {
    if (ts.rolls === 0) return { type: "ROLL" };
    if (ts.rollsLeft > 0 && rand() < 0.7) {
      const keep = ts.dice.map((_, i) => i).filter(() => rand() < 0.5);
      if (keep.length < ts.dice.length) return { type: "ROLL", keep };
    }
    return { type: "RESOLVE" };
  }
  const buys = legalActions(s, id).filter((c) => c.type === "BUY");
  if (buys.length > 0 && rand() < 0.7) return pick(buys);
  return { type: "END_TURN" };
};

const baselineB: Bot = (s, id) => {
  const me = s.players.find((p) => p.id === id)!;
  if (s.prompt?.kind === "yield") return { type: "YIELD", yield: me.life <= 5 };
  if (s.prompt?.kind === "wings") return { type: "WINGS", use: me.life <= s.prompt.damage };
  const ts = s.turnState;
  if (s.stage === "roll") {
    if (ts.rolls === 0) return { type: "ROLL" };
    const keep = ts.dice.map((d, i) => (d.face === "claw" || d.face === "energy" || (d.face === "heart" && !me.location) ? i : -1)).filter((i) => i >= 0);
    if (ts.rollsLeft > 0 && keep.length < ts.dice.length) return { type: "ROLL", keep };
    return { type: "RESOLVE" };
  }
  const cheapest = s.market.filter((c) => c !== null).sort((a, b) => cardPrice(s, me, a!.id) - cardPrice(s, me, b!.id))[0];
  if (cheapest && cardPrice(s, me, cheapest.id) <= me.energy) {
    const legal = legalActions(s, id).find((c) => c.type === "BUY" && c.uid === cheapest.uid);
    if (legal) return legal;
  }
  return { type: "END_TURN" };
};

const timings: number[] = [];
const mine: Bot = (s, id) => {
  const t0 = performance.now();
  const view = redactGameForViewer(s, id);
  const command = botCommand(view, id)!;
  timings.push(performance.now() - t0);
  return command;
};

function play(bots: Bot[], seed: number) {
  let s = createGame(bots.map((_, i) => ({ id: `p${i}`, name: `b${i}` })), seed);
  let n = 0;
  while (s.phase !== "finished") {
    if (n++ > 3000) throw new Error(`种子 ${seed} 超过 3000 步`);
    const id = actorId(s);
    const seat = Number(id.slice(1));
    s = applyCommand(s, id, bots[seat]!(s, id));
  }
  return s;
}

const GAMES = Number(process.argv[2] ?? 300);

function match(name: string, a: Bot, b: Bot, players: number, games = GAMES) {
  let w = 0, rank = 0;
  for (let i = 0; i < games; i++) {
    const seat = i % players;
    const bots = Array.from({ length: players }, (_, k) => (k === seat ? a : b));
    const s = play(bots, 1000 + i);
    const winners = s.finalResult!.winners;
    if (winners.includes(`p${seat}`)) w += 1 / winners.length;
    // 名次：赢家第 1，其余按（活着、分数）排
    const order = [...s.players].sort((x, y) => Number(winners.includes(y.id)) - Number(winners.includes(x.id)) || Number(y.alive) - Number(x.alive) || y.vp - x.vp);
    rank += order.findIndex((p) => p.id === `p${seat}`) + 1;
  }
  console.log(`${name}（${players} 人，${games} 局）：胜率 ${(100 * w / games).toFixed(1)}%（公平 ${(100 / players).toFixed(0)}%），平均名次 ${(rank / games).toFixed(2)}`);
}

function selfPlay(players: number, games = GAMES) {
  let turns = 0, vpWins = 0, lastWins = 0, allDead = 0;
  const t0 = performance.now();
  for (let i = 0; i < games; i++) {
    const s = play(Array.from({ length: players }, () => mine), 5000 + i);
    turns += s.turn;
    if (s.finalResult!.reason === "vp") vpWins++; else if (s.finalResult!.reason === "lastStanding") lastWins++; else allDead++;
  }
  console.log(`自对弈 ${players} 人 ${games} 局：平均 ${(turns / games).toFixed(1)} 回合，20 分获胜 ${(100 * vpWins / games).toFixed(0)}%、打翻全场 ${(100 * lastWins / games).toFixed(0)}%、全灭 ${allDead}，每局 ${((performance.now() - t0) / games).toFixed(0)}ms`);
}

match("人机 vs 随机 A", mine, randomBot, 2);
match("人机 vs 基线 B", mine, baselineB, 2);
match("人机 vs 基线 B", mine, baselineB, 4);
match("基线 B vs 随机 A", baselineB, randomBot, 2, 100);
for (const n of [2, 3, 4, 5, 6]) selfPlay(n);
timings.sort((a, b) => a - b);
const q = (p: number) => timings[Math.min(timings.length - 1, Math.floor(p * timings.length))]!.toFixed(2);
console.log(`单步耗时（含 redact）：${timings.length} 步，p50 ${q(0.5)}ms，p99 ${q(0.99)}ms，最坏 ${timings.at(-1)!.toFixed(2)}ms，平均 ${(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(3)}ms`);
