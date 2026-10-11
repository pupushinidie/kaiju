import { useEffect, useRef } from "react";
import { actorId, type GameEvent, type GameState } from "@kaiju/game";
import { sfx, synth, type SfxName } from "./gm-sound.js";

/**
 * 巨兽之城的动作音效：对比前后两次对局快照（version 和这一步的 events），给刚发生的动作配上声音。
 * 跟自己有关的（自己做的、自己挨打、自己得分）响亮，别人的减半（mine=false）。第一次拿到快照、
 * 再来一局、一下跳了好几步（重连补发）都不出声，只提示轮到你。
 *
 * - 掷骰 Rolled：dice（骰子数 = 重掷了几颗）
 * - 改骰 DieChanged：place
 * - 攻击 Attack：招牌「爪击」——三道撕裂的噪声
 * - 挨打 Damaged：hit；挡住了（双翼/装甲/伪装）：deny
 * - 进城 Entered：招牌「进城」——落地闷响 + 上行三音
 * - 让位 Yielded：pass；留下 Stayed：place
 * - 买卡 Bought：card；换一批 Swept：shuffle；卖卡 Sold：coin
 * - 得分 Vp：score（≥3 分算大）；能量 Energy：coin；回血 Healed：sparkle
 * - 出局 Eliminated：boom；重生 Reborn：sparkle
 * - 双翼 WingsUsed：招牌「扑翅」
 * - 超时 TurnTimedOut：自己的响 timeout
 * - 轮到你（包括被问让位、双翼）yourTurn；终局 gameOver(赢/输)
 */

function log(name: string) {
  const w = window as unknown as { __sfxLog?: string[] };
  if (import.meta.env.DEV) (w.__sfxLog ??= []).push(name);
}

function play<K extends SfxName>(name: K, ...args: Parameters<(typeof sfx)[K]>) {
  log(name);
  (sfx[name] as (...a: Parameters<(typeof sfx)[K]>) => void)(...args);
}

const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

/** 招牌：爪击——三道撕裂声。 */
function clawSwipe(mine: boolean) {
  log("clawSwipe");
  const v = synth.level(mine);
  for (let i = 0; i < 3; i += 1) {
    const at = i * 0.07;
    synth.noise({ at, duration: 0.08, volume: 0.3 * v, freq: 2400 * synth.jitter(0.2), freqTo: 700, q: 1.2 });
  }
  synth.tone(180, { at: 0.02, duration: 0.18, volume: 0.12 * v, type: "square", glideTo: 90 });
}

/** 招牌：进城——落地一声闷响，再上行三个音。 */
function enterCity(mine: boolean) {
  log("enterCity");
  const v = synth.level(mine);
  synth.noise({ at: 0, duration: 0.14, volume: 0.35 * v, filter: "lowpass", freq: 420 });
  synth.tone(110, { at: 0, duration: 0.2, volume: 0.2 * v, type: "triangle", glideTo: 70 });
  [523, 659, 784].forEach((freq, i) => synth.tone(freq, { at: 0.18 + i * 0.09, duration: 0.16, volume: 0.1 * v, type: "square" }));
}

/** 招牌：双翼扑翅。 */
function wings(mine: boolean) {
  log("wings");
  const v = synth.level(mine);
  for (let i = 0; i < 3; i += 1) synth.noise({ at: i * 0.12, duration: 0.1, volume: 0.22 * v, freq: 900, freqTo: 2200, q: 0.8 });
}

export function useGameSfx(game: GameState, selfId: string) {
  const previous = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || prev === game || prev.version === game.version) return;
    const nextIsMe = selfId !== "" && game.phase === "playing" && actorId(game) === selfId;
    const wasMe = selfId !== "" && prev.phase === "playing" && actorId(prev) === selfId;
    if (game.version < prev.version || game.version - prev.version > 3) {
      if (nextIsMe) later(400, () => play("yourTurn"));
      return;
    }
    const mineOf = (...ids: (string | null | undefined)[]) => selfId !== "" && ids.includes(selfId);
    const events: readonly GameEvent[] = game.events;
    let t = 0;
    let vpMine = 0;
    let vpOther = 0;
    let energyMine = false;
    let energyOther = false;
    let ended: Extract<GameEvent, { type: "GameEnded" }> | null = null;
    for (const event of events) {
      switch (event.type) {
        case "Rolled":
          play("dice", Math.max(1, Math.min(event.rerolled.length, 6)), mineOf(event.player));
          t = Math.max(t, 500);
          break;
        case "DieChanged":
          play("place", mineOf(event.player));
          break;
        case "Attack": {
          const mine = mineOf(event.player, ...event.targets);
          later(t, () => clawSwipe(mine));
          t += 220;
          break;
        }
        case "Damaged": {
          const mine = mineOf(event.player, event.source);
          if (event.amount > 0) later(t, () => play("hit", mine));
          else later(t, () => play("deny"));
          t += 120;
          break;
        }
        case "LifeLost":
          later(t, () => play("hit", mineOf(event.player)));
          t += 120;
          break;
        case "Entered": {
          const mine = mineOf(event.player);
          later(t + 100, () => enterCity(mine));
          t += 500;
          break;
        }
        case "Yielded":
          later(t, () => play("pass", mineOf(event.player, event.to)));
          t += 200;
          break;
        case "Stayed":
          later(t, () => play("place", mineOf(event.player)));
          t += 150;
          break;
        case "Bought":
          later(t, () => play("card", mineOf(event.player)));
          t += 200;
          break;
        case "Swept":
          later(t, () => play("shuffle"));
          t += 300;
          break;
        case "Sold":
          later(t, () => play("coin", mineOf(event.player)));
          break;
        case "Vp":
          if (mineOf(event.player)) vpMine += event.amount;
          else vpOther += event.amount;
          break;
        case "Energy":
          if (mineOf(event.player)) energyMine = true;
          else energyOther = true;
          break;
        case "Healed":
          later(t, () => play("sparkle", mineOf(event.player)));
          break;
        case "Eliminated": {
          const mine = mineOf(event.player, event.by);
          later(t + 150, () => play("boom", mine));
          t += 600;
          break;
        }
        case "Reborn":
          later(t, () => play("sparkle", mineOf(event.player)));
          break;
        case "WingsUsed": {
          const mine = mineOf(event.player);
          later(t, () => wings(mine));
          t += 350;
          break;
        }
        case "TurnTimedOut":
          if (mineOf(event.player)) later(t, () => play("timeout"));
          break;
        case "GameEnded":
          ended = event;
          break;
        default:
          break;
      }
    }
    if (vpMine > 0) later(t, () => play("score", true, vpMine >= 3));
    else if (vpOther > 0) later(t, () => play("score", false, false));
    if (vpMine > 0 || vpOther > 0) t += 300;
    if (energyMine) later(t, () => play("coin", true));
    else if (energyOther) later(t, () => play("coin", false));
    if (ended) {
      const won = selfId !== "" && ended.winners.includes(selfId);
      later(t + 600, () => play("gameOver", won));
      return;
    }
    if (nextIsMe && !wasMe) later(Math.max(t, 450), () => play("yourTurn"));
    else if (wasMe && !nextIsMe && game.events.some((event) => event.type === "TurnStarted")) later(Math.max(t, 300), () => play("turnPassed"));
  }, [game, selfId]);
}

export { play as playSfx };
