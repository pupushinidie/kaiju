/**
 * 预览页（开发用，提交进仓库）：用预览局面工厂造出各种牌桌状态，渲染真正的 GameBoard。
 *   http://localhost:5297/preview.html?s=<场景>&theme=day
 * 场景：SCENE_NAMES 里的全部（start、rolled、yield、wings、buy、bigTable、endTie…），
 * 外加 offline（对手离线）、auto（自己托管中）、spectate（观战）、rematch（终局 + 再来一局投票）。
 * 自己固定是 p1（座位 0）。URL 加 #click=<选择器> 时 shoot.mjs 会先点一下再截图。
 */
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { scene, SCENE_NAMES, type GameState, type LobbyMember, type LobbyRoomSnapshot, type SceneName } from "@kaiju/game";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { useConfirm } from "./confirm.js";
import { NO_BGM, SoundToggle, useBgm } from "./gm-sound.js";
import { applyTheme, ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./kaiju.css";
import "./theme-day.css";

const params = new URLSearchParams(window.location.search);
const name = params.get("s") ?? "rolled";
const themeParam = params.get("theme");
if (themeParam === "day" || themeParam === "night") applyTheme(themeParam);

const EXTRA = ["offline", "auto", "spectate", "rematch"] as const;

function buildRoom(): { room: LobbyRoomSnapshot; self?: string } {
  const base: SceneName = name === "offline" ? "offline" : name === "auto" ? "rolled" : name === "spectate" ? "bigTable" : name === "rematch" ? "endVp" : (SCENE_NAMES as readonly string[]).includes(name) ? (name as SceneName) : "rolled";
  const game: GameState = scene(base);
  const members: LobbyMember[] = game.players.map((player, index) => ({
    id: `sock-${player.id}`,
    playerId: player.id,
    name: player.name,
    isHost: index === 0,
    connected: !(name === "offline" && index === 2),
    ...(player.name.startsWith("咕噜") ? { bot: true } : {}),
    ...(name === "auto" && index === 0 ? { auto: true } : {}),
  }));
  const chat = [
    { id: "c1", senderId: "sock-p2", name: game.players[1]!.name, message: "我要进城心了！", createdAt: new Date(Date.now() - 60_000).toISOString() },
    { id: "c2", senderId: "sock-p1", name: game.players[0]!.name, message: "来呀，我留着爪呢", createdAt: new Date(Date.now() - 30_000).toISOString() },
  ];
  const room = {
    code: "KJ7Q2X",
    spectators: name === "spectate" ? [{ id: "sock-x", name: "看客" }] : [],
    access: { allowSpectators: true, spectatorsSeeAll: false, open: false },
    capacity: Math.max(2, Math.min(6, game.players.length)) as LobbyRoomSnapshot["capacity"],
    status: "playing" as const,
    members,
    chat,
    voice: [],
    ...(game.phase === "playing" ? { turnRemainingMs: 23_000 } : {}),
    ...(game.phase === "finished" ? { rematch: { remainingMs: 41_000, acceptedIds: name === "rematch" ? ["sock-p2"] : [] } } : {}),
    game,
  } as unknown as LobbyRoomSnapshot;
  return name === "spectate" ? { room } : { room, self: "p1" };
}

function Preview() {
  const [{ room: initial, self }] = useState(buildRoom);
  const [room, setRoom] = useState(initial);
  const [theme, toggleTheme] = useTheme();
  const voice = useVoice(null);
  useBgm(NO_BGM);
  const [confirmAction, confirmDialog] = useConfirm();
  void setRoom;
  return (
    <main className="app-shell kj-game" data-gc-table>
      <GameBoard
        room={room}
        busy={false}
        error={params.has("err") ? "能量不够。" : ""}
        notice=""
        brand={<a className="brand" href="#"><span className="brand-name">巨兽之城</span></a>}
        connection={<div className="connection-status online"><span className="connection-dot" />服务已连接</div>}
        themeToggle={<><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(command) => console.log("command", command)}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => void confirmAction({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
        watchId="p1"
        onWatch={() => undefined}
        onLeave={() => undefined}
        {...(self ? { selfOverride: self } : {})}
      />
      {confirmDialog}
      <nav className="preview-nav" style={{ position: "fixed", left: 4, bottom: 4, zIndex: 2000, display: params.has("nav") ? "flex" : "none", flexWrap: "wrap", gap: 4, maxWidth: 600 }}>
        {[...SCENE_NAMES, ...EXTRA].map((entry) => <a key={entry} href={`?s=${entry}&nav`} style={{ color: "#fff", background: "#000", padding: "0 4px", fontSize: 12 }}>{entry}</a>)}
      </nav>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
