// 引擎阶段的占位牌桌：只用文字和按钮把一局打完，界面阶段换成正式牌桌。
import type { ReactNode } from "react";
import { actorId, CARDS, legalActions, type GameCommand, type LobbyRoomSnapshot } from "@kaiju/game";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
}

function GameBoard({ room, busy, error, brand, onCommand, onRematch }: GameBoardProps) {
  const game = room.game!;
  const selfId = room.members.find((member) => member.id === socket.id)?.playerId ?? "";
  const actions = legalActions(game, selfId);
  return (
    <main className="app-shell" data-gc-table>
      {brand}
      <p>轮到：{actorId(game)}　阶段：{game.stage}</p>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>{player.name} 生命 {player.life} 分 {player.vp} 能量 {player.energy} {player.location ?? ""} {player.cards.map((card) => CARDS[card.id].name).join("、")}</li>
        ))}
      </ul>
      <p>骰子：{game.turnState.dice.map((die) => die.face ?? "?").join(" ")}</p>
      <div>
        {actions.map((action, index) => (
          <button key={index} type="button" disabled={busy} onClick={() => onCommand(action)}>{JSON.stringify(action)}</button>
        ))}
      </div>
      {game.phase === "finished" && <button type="button" onClick={() => onRematch(true)}>再来一局</button>}
      {error && <p>{error}</p>}
    </main>
  );
}

export default GameBoard;
