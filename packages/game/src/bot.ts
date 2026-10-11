import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 占位人机：从合法动作里随机挑一个（人机阶段换成正式策略）。
 * 输入必须是 redactGameForViewer 处理过的状态。
 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const options = legalActions(state, playerId).filter((command) => command.type !== "RAPID_HEAL");
  if (options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)]!;
}
