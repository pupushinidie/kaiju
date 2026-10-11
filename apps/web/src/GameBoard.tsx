import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  actorId,
  CARDS,
  cardPrice,
  hasCard,
  maxLifeOf,
  mimicTargets,
  type CardId,
  type CardInstance,
  type Face,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Player,
  type Spot,
} from "@kaiju/game";
import { bgArt, boardArt, cardArt, dieArt, fxArt, iconArt, MONSTERS, monsterArt, tokenArt } from "./art.js";
import { CardChip, CardFace } from "./Card.js";
import { describeEvent, FACE_NAME, SPOT_NAME } from "./describe.js";
import { useGameSfx } from "./game-sfx.js";
import GameRules from "./GameRules.js";
import { useSfxCountdown } from "./gm-sound.js";
import { pickScales, type Scales } from "./layout.js";
import { GameRoomMenu } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorialGame.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮（和 ♪）。 */
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
  /** 教程：叠在中间的教练框、只放行某些动作、自己的座位 id（教程里没有 socket）。 */
  readonly coach?: ReactNode;
  readonly allow?: (command: GameCommand) => boolean;
  readonly selfOverride?: string;
  /** online：真实对局（默认）；tutorial：剧本进行中（不出提示和小贴士）；practice：练习局（随时能看提示）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 结算框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
}

type Banner = { key: string; text: string; tone: "turn" | "hit" | "city" | "ko" | "info" };
type Fx = { id: number; kind: "claw" | "ko" | "enter" | "float"; player?: string; spot?: Spot; text?: string; tone?: "hurt" | "heal" | "vp" | "energy" };
type Detail = { uid: string; id: CardId };
type Picker = { kind: "mimic-buy"; uid: string } | { kind: "mimic-move" } | { kind: "battery"; uid: string };

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

/** 牌桌中间区域的实测尺寸 → 整数倍缩放。 */
function useScales(boards: number, dice: number): [React.RefObject<HTMLElement | null>, Scales, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 760, h: 700, mobile: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const mobile = window.innerWidth < 700;
      setSize({ w: Math.floor(element.clientWidth), h: Math.floor(element.clientHeight), mobile });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const scales: Scales = size.mobile
    ? { board: 1, dice: 1, card: 1, arrangement: "stack", diceCols: Math.min(6, Math.max(1, dice)) }
    : pickScales(size.w, size.h, boards, dice);
  return [ref, scales, size.mobile];
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onLeave, coach, allow } = props;
  const game = room.game!;
  const member = props.selfOverride
    ? room.members.find((candidate) => candidate.playerId === props.selfOverride)
    : room.members.find((candidate) => candidate.id === socket.id);
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const current = game.players[game.currentPlayer]!;
  const me = game.players.find((player) => player.id === myId) ?? game.players[0]!;
  const actor = actorId(game);
  const autoPlaying = member?.auto === true;
  const playing = game.phase === "playing";
  const canAct = !spectating && playing && actor === selfId && !autoPlaying;
  const myTurn = !spectating && playing && current.id === selfId;
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const [drawer, setDrawer] = useState(false);

  useGameSfx(game, selfId);
  useSfxCountdown(canAct, secondsLeft);
  const mode = props.mode ?? "online";

  // 「提示」：练习局随时能用；真实对局里只有自己和人机时能用（有别的真人就不显示，免得不公平）
  const botsOnly = room.members.length > 1 && room.members.every((candidate) => candidate.playerId === myId || candidate.bot === true);
  const canHint = canAct && (mode === "practice" || (mode === "online" && botsOnly));
  const [hint, setHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = hint && hint.version === game.version && canHint ? hint.hint : null;
  const toggleHint = () => setHint((current) => (current && current.version === game.version ? null : { version: game.version, hint: hintFor(game, myId) }));
  useEffect(() => {
    if (!canHint) return;
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key.toLowerCase() === "h") toggleHint();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canHint, game.version]);
  // 真实对局里第一次遇到某条规则（第一次进城心、第一次中毒……）时弹一句小贴士
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, myId), TIPS, mode === "online" && !spectating);

  const send = (command: GameCommand) => {
    if (allow && !allow(command)) return;
    onCommand(command);
  };

  // ---------- 留骰、改骰 ----------
  const ts = game.turnState;
  const turnKey = `${game.turn}:${ts.player}`;
  const [keep, setKeep] = useState<{ key: string; set: number[] }>({ key: turnKey, set: [] });
  const kept = keep.key === turnKey ? keep.set : [];
  const [tool, setTool] = useState<null | "herd-culler" | "plot-twist" | "stretchy">(null);
  const [changing, setChanging] = useState<number | null>(null);
  useEffect(() => {
    setTool(null);
    setChanging(null);
  }, [game.version]);

  // ---------- 卡牌详情和选择 ----------
  const [detail, setDetail] = useState<Detail | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  useEffect(() => {
    if (detail && !findCard(game, detail.uid)) setDetail(null);
  }, [game.version]);

  // ---------- 动画和横幅：只看 version 变没变；计时器放在持久的表里，只在卸载时清 ----------
  const [banner, setBanner] = useState<Banner | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [rolling, setRolling] = useState<{ key: string; dice: number[] } | null>(null);
  const timers = useRef(new Set<number>());
  const fxSeq = useRef(0);
  const seenVersion = useRef(game.version);
  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
  }, []);
  const later = (ms: number, fn: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  };
  const addFx = (effect: Omit<Fx, "id">, ms: number) => {
    fxSeq.current += 1;
    const id = fxSeq.current;
    setFx((list) => [...list, { ...effect, id }]);
    later(ms, () => setFx((list) => list.filter((entry) => entry.id !== id)));
  };
  useEffect(() => {
    if (game.version === seenVersion.current) return;
    const restarted = game.version < seenVersion.current;
    const jump = game.version - seenVersion.current;
    seenVersion.current = game.version;
    if (restarted || jump > 3) return;
    const key = String(game.version);
    const sums = new Map<string, { hurt: number; heal: number; vp: number; energy: number }>();
    const sum = (id: string) => {
      let entry = sums.get(id);
      if (!entry) {
        entry = { hurt: 0, heal: 0, vp: 0, energy: 0 };
        sums.set(id, entry);
      }
      return entry;
    };
    let next: Banner | null = null;
    for (const event of game.events) {
      switch (event.type) {
        case "Rolled":
          setRolling({ key, dice: event.rerolled });
          later(650, () => setRolling((value) => (value?.key === key ? null : value)));
          break;
        case "Damaged":
          if (event.amount > 0) {
            sum(event.player).hurt += event.amount;
            addFx({ kind: "claw", player: event.player }, 7 * 70 + 40);
          }
          break;
        case "LifeLost":
          sum(event.player).hurt += event.amount;
          break;
        case "Healed":
          sum(event.player).heal += event.amount;
          break;
        case "Vp":
          sum(event.player).vp += event.amount;
          break;
        case "VpLost":
          sum(event.player).vp -= event.amount;
          break;
        case "Energy":
          sum(event.player).energy += event.amount;
          break;
        case "EnergyLost":
          sum(event.player).energy -= event.amount;
          break;
        case "Eliminated":
          addFx({ kind: "ko", player: event.player }, 9 * 90 + 40);
          next = { key, text: `${nameOf(event.player)} 倒下了！`, tone: "ko" };
          break;
        case "Entered":
          addFx({ kind: "enter", spot: event.spot }, 8 * 80 + 40);
          if (!next || next.tone !== "ko") next = { key, text: `${nameOf(event.player)} 进入${SPOT_NAME[event.spot]}！`, tone: "city" };
          break;
        case "Yielded":
          next = { key, text: `${nameOf(event.player)} 让出了${SPOT_NAME[event.spot]}`, tone: "info" };
          break;
        case "Attack":
          if (event.targets.includes(selfId) && !next) next = { key, text: `${nameOf(event.player)} 打你 ${event.damage} 下！`, tone: "hit" };
          break;
        case "TurnStarted":
          if (event.player === selfId && !autoPlaying && !next) next = { key, text: event.extra ? "再来一回合！" : "轮到你了", tone: "turn" };
          break;
        default:
          break;
      }
    }
    for (const [player, entry] of sums) {
      const parts: { text: string; tone: Fx["tone"] }[] = [];
      if (entry.hurt > 0) parts.push({ text: `-${entry.hurt}❤`, tone: "hurt" });
      if (entry.heal > 0) parts.push({ text: `+${entry.heal}❤`, tone: "heal" });
      if (entry.vp !== 0) parts.push({ text: `${entry.vp > 0 ? "+" : ""}${entry.vp}★`, tone: "vp" });
      if (entry.energy !== 0) parts.push({ text: `${entry.energy > 0 ? "+" : ""}${entry.energy}⚡`, tone: "energy" });
      parts.forEach((part, index) => later(index * 220, () => addFx({ kind: "float", player, text: part.text, ...(part.tone ? { tone: part.tone } : {}) }, 1500)));
    }
    if (next) {
      const shown = next;
      setBanner(shown);
      later(1900, () => setBanner((value) => (value?.key === shown.key ? null : value)));
    }
  }, [game.version]);

  // 轮到自己而页面在后台时，标签页标题提醒一下
  useEffect(() => {
    const base = document.title.replace(/^【轮到你】/, "");
    const update = () => { document.title = canAct && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [canAct]);

  const boards = game.bayOpen ? 2 : 1;
  const [centerRef, scales, mobile] = useScales(boards, ts.dice.length);

  // ---------- 提示条 ----------
  let prompt: string;
  if (game.phase === "finished") {
    const winners = game.finalResult!.winners;
    prompt = winners.length === 0 ? "全员倒下，没有赢家" : `${winners.map(nameOf).join("、")} 获胜！`;
  } else if (autoPlaying) prompt = "托管中：人机替你走";
  else if (game.prompt) {
    const who = game.prompt.player;
    if (who === selfId) prompt = game.prompt.kind === "yield" ? "你挨打了：让位还是留下？" : "要不要用双翼？";
    else prompt = game.prompt.kind === "yield" ? `等 ${nameOf(who)} 决定让不让位` : `等 ${nameOf(who)} 决定用不用双翼`;
  } else if (myTurn && game.stage === "roll") {
    if (ts.rolls === 0) prompt = "轮到你了：掷骰子";
    else if (tool) prompt = changing === null ? "点一颗骰子来改" : "改成哪一面？";
    else if (ts.rollsLeft > 0) prompt = `点骰子留下，重掷其余的（还能重掷 ${ts.rollsLeft} 次）`;
    else prompt = "重掷次数用完了，点「结算」";
  } else if (myTurn) prompt = "买超能力卡（点卡看详情），或者结束回合";
  else prompt = `${current.name} ${game.stage === "roll" ? "在掷骰子" : "在买卡"}`;

  const showTimer = playing && secondsLeft !== null && !robotActor(room, actor);

  // ---------- 掷骰动作 ----------
  const smoke = me.cards.find((card) => card.id === "smoke-cloud" && (card.smoke ?? 0) > 0);
  const rerollIdx = ts.dice.map((_, i) => i).filter((i) => !kept.includes(i));
  const dwellerFree = hasCard(game, me, "background-dweller") && ts.dwellerRerolls < 10 && rerollIdx.length > 0 && rerollIdx.every((i) => ts.dice[i]!.face === "3");
  const rollCommand = (use?: "smoke" | "telepath"): GameCommand => (use ? { type: "ROLL", keep: kept, use } : { type: "ROLL", keep: kept });
  const tools: { via: "herd-culler" | "plot-twist" | "stretchy"; label: string; ok: boolean }[] = [];
  if (myTurn && game.stage === "roll" && ts.rolls > 0 && !ts.resolved) {
    if (hasCard(game, me, "herd-culler")) tools.push({ via: "herd-culler", label: "剔除弱者：改成 1", ok: !ts.herdCullerUsed });
    if (me.cards.some((card) => card.id === "plot-twist")) tools.push({ via: "plot-twist", label: "剧情反转：改任意面", ok: true });
    if (hasCard(game, me, "stretchy")) tools.push({ via: "stretchy", label: "弹性：2⚡ 改任意面", ok: me.energy >= 2 });
  }

  function clickDie(index: number) {
    if (!canAct || game.stage !== "roll" || ts.rolls === 0 || ts.resolved) return;
    if (tool) {
      if (tool === "herd-culler") send({ type: "CHANGE_DIE", index, face: "1", via: tool });
      else setChanging(index);
      return;
    }
    setKeep({ key: turnKey, set: kept.includes(index) ? kept.filter((i) => i !== index) : [...kept, index].sort((a, b) => a - b) });
  }

  let actions: ReactNode = null;
  if (canAct && game.stage === "roll") {
    if (ts.rolls === 0) {
      const mimic = me.cards.find((card) => card.id === "mimic");
      actions = (
        <>
          <button className="primary-button kj-big" type="button" disabled={busy} onClick={() => send({ type: "ROLL" })} data-tutorial="roll-button">掷骰子</button>
          {mimic && me.energy >= 1 && <button className="quiet-button" type="button" onClick={() => setPicker({ kind: "mimic-move" })}>换模仿目标（1⚡）</button>}
        </>
      );
    } else if (tool) {
      actions = <button className="quiet-button kj-big" type="button" onClick={() => { setTool(null); setChanging(null); }}>取消改骰</button>;
    } else {
      actions = (
        <>
          {ts.rollsLeft > 0 || dwellerFree ? (
            <button className="primary-button kj-big" type="button" disabled={busy || rerollIdx.length === 0} onClick={() => send(rollCommand())} data-tutorial="reroll-button">
              {rerollIdx.length === 0 ? "全留了" : dwellerFree && ts.rollsLeft === 0 ? `免费重掷 ${rerollIdx.length} 颗 3` : `重掷 ${rerollIdx.length} 颗`}
            </button>
          ) : (
            <>
              {smoke && <button className="quiet-button" type="button" disabled={busy || rerollIdx.length === 0} onClick={() => send(rollCommand("smoke"))}>烟雾重掷（剩 {smoke.smoke}）</button>}
              {hasCard(game, me, "telepath") && <button className="quiet-button" type="button" disabled={busy || rerollIdx.length === 0 || me.energy < 1} onClick={() => send(rollCommand("telepath"))}>心灵感应重掷（1⚡）</button>}
            </>
          )}
          <button className={ts.rollsLeft > 0 ? "quiet-button kj-big" : "primary-button kj-big"} type="button" disabled={busy} onClick={() => send({ type: "RESOLVE" })} data-tutorial="resolve-button">结算</button>
          {tools.map((entry) => (
            <button key={entry.via} className="quiet-button" type="button" disabled={!entry.ok || busy} onClick={() => { setTool(entry.via); setChanging(null); }}>{entry.label}</button>
          ))}
        </>
      );
    }
  } else if (canAct && game.stage === "buy") {
    actions = (
      <>
        <button className="primary-button kj-big" type="button" disabled={busy} onClick={() => send({ type: "END_TURN" })} data-tutorial="end-turn">结束回合</button>
        <button className="quiet-button kj-big" type="button" disabled={busy || me.energy < 2} onClick={() => send({ type: "SWEEP" })} data-tutorial="sweep">换一批（2⚡）</button>
      </>
    );
  }

  // ---------- 买卡 ----------
  const canBuyNow = canAct && game.stage === "buy";
  function buy(card: CardInstance) {
    if (card.id === "mimic" && mimicTargets(game).length > 0) {
      setPicker({ kind: "mimic-buy", uid: card.uid });
      return;
    }
    if (card.id === "monster-batteries") {
      setPicker({ kind: "battery", uid: card.uid });
      return;
    }
    send({ type: "BUY", uid: card.uid });
    setDetail(null);
  }

  const style = { "--turn": MONSTERS[current.monster].hex, "--bg-night": `url(${bgArt.night})`, "--bg-day": `url(${bgArt.day})` } as CSSProperties;
  const playersPanel = (only?: "me" | "others") => (
    <PlayersPanel
      game={game}
      selfId={selfId}
      memberOf={memberOf}
      fx={fx}
      only={only}
      onCard={(card) => setDetail({ uid: card.uid, id: card.id })}
      onRapidHeal={!spectating && playing && !autoPlaying ? () => send({ type: "RAPID_HEAL" }) : null}
    />
  );

  return (
    <div className={mobile ? "kj-screen mobile" : "kj-screen"} style={style}>
      <header className="kj-topbar">
        {brand}
        <div className={canAct ? "kj-turn mine" : "kj-turn"} data-tutorial="turn">
          {playing && <img src={monsterArt.icon(current.monster)} alt="" />}
          <b>{playing ? (current.id === selfId ? "你的回合" : `${current.name} 的回合`) : "对局结束"}</b>
          {showTimer && <b className={secondsLeft! <= 5 ? "kj-timer low" : "kj-timer"}>{secondsLeft}s</b>}
        </div>
        <div className="kj-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          <button className="quiet-button kj-drawer-toggle" type="button" onClick={() => setDrawer((open) => !open)}>{drawer ? "收起" : "战况·聊天"}</button>
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <div className="kj-layout">
        {!mobile && playersPanel()}

        <section className={`kj-center ${scales.arrangement}`} ref={centerRef}>
          <div className={canAct ? "kj-prompt mine" : "kj-prompt"} role="status" data-tutorial="prompt">
            <span>{prompt}</span>
            {canHint && (
              <button className={shownHint ? "quiet-button kj-hint on" : "quiet-button kj-hint"} type="button" data-tutorial="hint" onClick={toggleHint}>提示</button>
            )}
            {autoPlaying && playing && <button className="quiet-button kj-auto-cancel" type="button" onClick={() => onAuto(false)} data-tutorial="auto-cancel">取消托管</button>}
            {(error || shownNotice) && <em className={error ? "kj-feedback error" : "kj-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</em>}
          </div>
          {mobile && !spectating && playersPanel("me")}
          <CityBoards game={game} scale={scales.board} fx={fx} nameOf={nameOf} />
          <div className="kj-dicebox" data-tutorial="dice">
            <div className="kj-dice" style={{ "--cols": scales.diceCols, "--dice-s": scales.dice } as CSSProperties}>
              {ts.dice.map((die, index) => {
                const isKept = kept.includes(index) && myTurn && ts.rolls > 0 && !ts.resolved;
                const isRolling = rolling !== null && rolling.dice.includes(index);
                const clickable = canAct && game.stage === "roll" && ts.rolls > 0 && !ts.resolved;
                return (
                  <button
                    key={index}
                    type="button"
                    className={["kj-die", isKept ? "kept" : "", isRolling ? "rolling" : "", clickable ? "clickable" : "", changing === index ? "changing" : "", tool ? "tool" : ""].filter(Boolean).join(" ")}
                    onClick={() => clickDie(index)}
                    disabled={!clickable}
                    aria-label={die.face ? `骰子 ${FACE_NAME[die.face]}${isKept ? "（留下）" : ""}` : "还没掷"}
                    data-tutorial={`die-${index}`}
                  >
                    <img src={dieArt(die.face, die.green)} alt="" draggable={false} />
                    {isKept && <i>留</i>}
                  </button>
                );
              })}
              {ts.dice.length === 0 && <p className="kj-muted">缩小标记太多，一颗骰子都没有</p>}
            </div>
            {changing !== null && tool && tool !== "herd-culler" && (
              <div className="kj-faces" role="group" aria-label="改成哪一面">
                {(["1", "2", "3", "energy", "heart", "claw"] as Face[]).map((face) => (
                  <button key={face} type="button" className="kj-face-pick" onClick={() => send({ type: "CHANGE_DIE", index: changing, face, via: tool })}>
                    <img src={dieArt(face)} alt={FACE_NAME[face]} />
                  </button>
                ))}
              </div>
            )}
            <div className="kj-actions" data-tutorial="actions">{actions}</div>
          </div>
          <Market game={game} me={me} scale={scales.card} canBuy={canBuyNow} onOpen={(card) => setDetail({ uid: card.uid, id: card.id })} onBuy={buy} compactDeck={mobile} />
          {coach}
          {banner && (
            <div className={`kj-banner ${banner.tone}`} key={banner.key} aria-hidden="true">
              {banner.tone === "city" && <img src={iconArt.crown} alt="" />}
              {banner.tone === "hit" && <img src={iconArt.claw} alt="" />}
              {banner.text}
            </div>
          )}
        </section>

        {mobile && playersPanel(spectating ? undefined : "others")}
        <aside className={drawer ? "kj-side open" : "kj-side"}>
          <LogPanel game={game} nameOf={nameOf} />
          <div className="kj-chat">{chat}</div>
        </aside>
      </div>

      {detail && (
        <CardDetail
          game={game}
          me={me}
          detail={detail}
          canAct={canAct}
          myTurn={myTurn}
          spectating={spectating}
          onClose={() => setDetail(null)}
          onBuy={buy}
          onSell={(uid) => { send({ type: "SELL", uid }); setDetail(null); }}
          onRapidHeal={() => send({ type: "RAPID_HEAL" })}
          onMimicMove={() => { setDetail(null); setPicker({ kind: "mimic-move" }); }}
        />
      )}
      {picker && (picker.kind === "mimic-buy" || picker.kind === "mimic-move") && (
        <MimicPicker
          game={game}
          title={picker.kind === "mimic-buy" ? "模仿哪张卡？" : "模仿标记换到哪张卡？（1 能量）"}
          exclude={picker.kind === "mimic-move" ? me.cards.find((card) => card.id === "mimic")?.mimic : undefined}
          onCancel={() => setPicker(null)}
          onPick={(target) => {
            if (picker.kind === "mimic-buy") send({ type: "BUY", uid: picker.uid, mimicTarget: target });
            else send({ type: "MIMIC", target });
            setPicker(null);
            setDetail(null);
          }}
        />
      )}
      {picker?.kind === "battery" && (
        <BatteryPicker
          max={Math.max(0, me.energy - cardPrice(game, me, "monster-batteries"))}
          onCancel={() => setPicker(null)}
          onPick={(amount) => {
            send({ type: "BUY", uid: picker.uid, batteryEnergy: amount });
            setPicker(null);
            setDetail(null);
          }}
        />
      )}
      {canAct && game.prompt?.kind === "yield" && game.prompt.player === selfId && (
        <YieldDialog game={game} nameOf={nameOf} secondsLeft={showTimer ? secondsLeft : null} onAnswer={(answer) => send({ type: "YIELD", yield: answer })} />
      )}
      {canAct && game.prompt?.kind === "wings" && game.prompt.player === selfId && (
        <WingsDialog damage={game.prompt.damage} energy={me.energy} secondsLeft={showTimer ? secondsLeft : null} onAnswer={(answer) => send({ type: "WINGS", use: answer })} />
      )}
      {game.phase === "finished" && <FinalDialog game={game} room={room} selfId={selfId} spectating={spectating} onRematch={onRematch} onLeave={onLeave} actions={props.finalActions} />}
      {shownHint && (
        <Coach
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
    </div>
  );
}

function robotActor(room: LobbyRoomSnapshot, playerId: string): boolean {
  const member = room.members.find((candidate) => candidate.playerId === playerId);
  return !member || member.bot === true || member.auto === true || !member.connected;
}

function findCard(game: GameState, uid: string): CardInstance | null {
  for (const card of game.market) if (card?.uid === uid) return card;
  if (game.peek?.uid === uid) return game.peek;
  for (const player of game.players) for (const card of player.cards) if (card.uid === uid) return card;
  return null;
}

// ---------------------------------------------------------------- 玩家面板

function PlayersPanel({ game, selfId, memberOf, fx, only, onCard, onRapidHeal }: {
  game: GameState;
  selfId: string;
  only?: "me" | "others" | undefined;
  memberOf: (id: string) => LobbyMember | undefined;
  fx: Fx[];
  onCard: (card: CardInstance) => void;
  onRapidHeal: (() => void) | null;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setCompact(window.innerWidth >= 700 && element.clientHeight / game.players.length < 112);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [game.players.length]);
  const mimicked = new Set(game.players.flatMap((player) => player.cards.map((card) => card.mimic).filter((uid): uid is string => !!uid)));
  return (
    <section className={compact ? "kj-players compact" : "kj-players"} ref={ref} data-tutorial="players">
      {game.players.map((player, index) => {
        if ((only === "me" && player.id !== selfId) || (only === "others" && player.id === selfId)) return null;
        const active = game.phase === "playing" && game.currentPlayer === index;
        const seat = memberOf(player.id);
        const offline = seat ? !seat.connected : false;
        const mine = player.id === selfId;
        const max = maxLifeOf(game, player);
        const effects = fx.filter((entry) => entry.player === player.id);
        const asking = game.prompt?.player === player.id;
        const heal = mine && onRapidHeal && hasCard(game, player, "rapid-healing") && player.alive;
        return (
          <article
            key={player.id}
            className={["kj-player", active ? "active" : "", mine ? "me" : "", player.alive ? "" : "dead", asking ? "asking" : "", effects.some((entry) => entry.kind === "claw") ? "hit" : ""].filter(Boolean).join(" ")}
            style={{ "--seat": MONSTERS[player.monster].hex } as CSSProperties}
            data-tutorial={mine ? "my-panel" : `player-${index}`}
          >
            <div className="kj-avatar">
              <img src={player.alive ? monsterArt.mini(player.monster) : monsterArt.ko(player.monster)} alt="" draggable={false} />
              {effects.filter((entry) => entry.kind === "claw").slice(0, 1).map((entry) => <span key={entry.id} className="kj-fx claw" style={{ backgroundImage: `url(${fxArt.claw.src})` }} />)}
              {effects.filter((entry) => entry.kind === "ko").map((entry) => <span key={entry.id} className="kj-fx ko" style={{ backgroundImage: `url(${fxArt.ko.src})` }} />)}
              {player.location && <img className="kj-crown" src={iconArt.crown} alt={SPOT_NAME[player.location]} />}
            </div>
            <div className="kj-player-main">
              <strong>
                <span className="kj-name">{player.name}</span>
                {mine && <small className="kj-tag you">你</small>}
                {seat?.bot && <small className="kj-tag bot">人机</small>}
                {!seat?.bot && (seat?.auto || offline) && <small className="kj-tag auto">托管</small>}
                {offline && <small className="kj-tag off">离线</small>}
                {player.location && <small className="kj-tag city">{SPOT_NAME[player.location]}</small>}
                {!player.alive && <small className="kj-tag off">出局</small>}
              </strong>
              <div className="kj-stats">
                <span className="kj-stat life" title="生命"><img src={iconArt.heart} alt="生命" /><b>{player.life}</b>{!compact && <small>/{max}</small>}</span>
                <span className="kj-stat vp" title="分数"><img src={iconArt.star} alt="分数" /><b>{player.vp}</b></span>
                <span className="kj-stat energy" title="能量"><img src={iconArt.energy} alt="能量" /><b>{player.energy}</b></span>
              </div>
            </div>
            <div className="kj-player-extra">
              {player.poison > 0 && <span className="kj-token" title="中毒标记：回合结束每个掉 1 血"><img src={tokenArt.poison} alt="中毒" /><b>{player.poison}</b></span>}
              {player.shrink > 0 && <span className="kj-token" title="缩小标记：每个少掷 1 颗骰"><img src={tokenArt.shrink} alt="缩小" /><b>{player.shrink}</b></span>}
              {player.cards.map((card) => (
                <CardChip
                  key={card.uid}
                  id={card.id}
                  onClick={() => onCard(card)}
                  mimic={mimicked.has(card.uid)}
                  {...(card.id === "smoke-cloud" ? { extra: `${card.smoke ?? 0}` } : card.id === "monster-batteries" ? { extra: `${card.battery ?? 0}` } : {})}
                />
              ))}
              {heal && (
                <button className="quiet-button kj-heal" type="button" disabled={player.energy < 2 || player.life >= max} onClick={onRapidHeal!}>治疗 2⚡</button>
              )}
            </div>
            {effects.filter((entry) => entry.kind === "float").map((entry, order) => (
              <span key={entry.id} className={`kj-float ${entry.tone ?? ""}`} style={{ "--i": order } as CSSProperties}>{entry.text}</span>
            ))}
          </article>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------- 城心和港湾

/** 城市板画布 160×128，上面再留 52 给站着的怪兽露头；怪兽脚底 (64,120) 对准城心 (84,68)、港湾 (84,80)。 */
function CityBoards({ game, scale, fx, nameOf }: { game: GameState; scale: number; fx: Fx[]; nameOf: (id: string) => string }) {
  const spots: Spot[] = game.bayOpen ? ["city", "bay"] : ["city"];
  return (
    <div className="kj-boards" data-tutorial="city">
      {spots.map((spot) => {
        const occupantId = game[spot];
        const occupant = occupantId ? game.players.find((player) => player.id === occupantId) : undefined;
        const waiting = !occupant && game.phase === "playing" && (spot === "city" || !!game.city);
        const enter = fx.find((entry) => entry.kind === "enter" && entry.spot === spot);
        const foot = spot === "city" ? 68 : 80;
        return (
          <div className="kj-spot" key={spot} style={{ width: 160 * scale, height: 180 * scale }} data-tutorial={spot === "city" ? "city-heart" : "harbor"}>
            <img className="kj-board-img" src={spot === "city" ? boardArt.heart : boardArt.harbor} alt="" style={{ width: 160 * scale, height: 128 * scale, top: 52 * scale }} draggable={false} />
            {waiting && <img className="kj-board-glow" src={spot === "city" ? boardArt.glowHeart : boardArt.glowHarbor} alt="" style={{ width: 160 * scale, height: 128 * scale, top: 52 * scale }} draggable={false} />}
            {occupant && (
              <span
                key={occupant.id}
                className={enter ? "kj-occupant entering" : "kj-occupant"}
                style={{
                  width: 128 * scale,
                  height: 128 * scale,
                  left: (84 - 64) * scale,
                  top: (52 + foot - 120) * scale,
                  backgroundImage: `url(${monsterArt.idle(occupant.monster)})`,
                }}
                role="img"
                aria-label={occupant.name}
              />
            )}
            {enter && <span className="kj-fx enter" style={{ width: 160 * scale, height: 64 * scale, top: (52 + foot - 56) * scale, backgroundImage: `url(${fxArt.enter.src})` }} />}
            <span className="kj-spot-label">
              {spot === "city" ? "城心" : "港湾"}
              {occupant ? <b>{nameOf(occupant.id)}</b> : waiting ? <b>空着</b> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- 公开卡

function Market({ game, me, scale, canBuy, onOpen, onBuy, compactDeck }: {
  game: GameState;
  me: Player;
  scale: number;
  canBuy: boolean;
  onOpen: (card: CardInstance) => void;
  onBuy: (card: CardInstance) => void;
  compactDeck: boolean;
}) {
  return (
    <div className="kj-market" data-tutorial="market">
      {game.market.map((card, slot) => {
        if (!card) {
          return (
            <div className="kj-card-slot" key={`empty-${slot}`}>
              <div className="kj-card-empty" style={{ width: 96 * scale, height: 136 * scale }}>牌堆空了</div>
              <div className="kj-buy-row" />
            </div>
          );
        }
        const price = cardPrice(game, me, card.id);
        const affordable = price <= me.energy;
        return (
          <div className="kj-card-slot" key={card.uid}>
            <CardFace id={card.id} scale={scale} price={price} onClick={() => onOpen(card)} dim={canBuy && !affordable} tutorial={`card-${slot}`} />
            <div className="kj-buy-row">
              {canBuy && (
                <button className="quiet-button kj-buy" type="button" disabled={!affordable} onClick={() => onBuy(card)} data-tutorial={`buy-${slot}`}>
                  买 {price}<img src={iconArt.energy} alt="能量" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className={compactDeck ? "kj-deck compact" : "kj-deck"} data-tutorial="deck">
        {!compactDeck && <img src={cardArt.back} alt="" draggable={false} />}
        <span>牌堆 {game.deckCount}</span>
        {game.peek && <button className="quiet-button" type="button" onClick={() => onOpen(game.peek!)}>堆顶</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 弹窗

function Modal({ children, onClose, className = "" }: { children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div
      className="gm-modal-backdrop kj-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (onClose && event.key === "Escape") onClose();
      }}
    >
      <section className={`gm-panel ${className}`} role="dialog" aria-modal="true">{children}</section>
    </div>
  );
}

function CardDetail({ game, me, detail, canAct, myTurn, spectating, onClose, onBuy, onSell, onRapidHeal, onMimicMove }: {
  game: GameState;
  me: Player;
  detail: Detail;
  canAct: boolean;
  myTurn: boolean;
  spectating: boolean;
  onClose: () => void;
  onBuy: (card: CardInstance) => void;
  onSell: (uid: string) => void;
  onRapidHeal: () => void;
  onMimicMove: () => void;
}) {
  const card = findCard(game, detail.uid);
  if (!card) return null;
  const def = CARDS[card.id];
  const owner = game.players.find((player) => player.cards.some((candidate) => candidate.uid === card.uid));
  const inMarket = game.market.some((candidate) => candidate?.uid === card.uid) || game.peek?.uid === card.uid;
  const price = cardPrice(game, me, card.id);
  const buyStage = canAct && game.stage === "buy";
  const canBuy = buyStage && price <= me.energy && (inMarket || (!!owner && owner.id !== me.id && hasCard(game, me, "parasitic-tentacles")));
  const mine = owner?.id === me.id && !spectating;
  const mimicTarget = card.mimic ? findCard(game, card.mimic) : null;
  const wide = window.innerWidth >= 700 && window.innerHeight >= 640;
  return (
    <Modal onClose={onClose} className="kj-detail">
      <CardFace id={card.id} scale={wide ? 3 : 2} price={mine ? def.cost : price} />
      <div className="kj-detail-body">
        <h2>{def.name}</h2>
        <p className="kj-detail-kind">{def.kind === "keep" ? "保留：买下后一直放在面前生效" : "一次性：买下立刻生效，然后弃掉"}</p>
        <p className="kj-detail-text">{def.text}</p>
        {owner && <p className="kj-muted">在{owner.id === me.id && !spectating ? "你" : ` ${owner.name} `}面前{card.smoke !== undefined ? `，还剩 ${card.smoke} 个烟雾标记` : ""}{card.battery !== undefined ? `，电池里还有 ${card.battery} 能量` : ""}</p>}
        {mimicTarget && <p className="kj-muted">正在模仿「{CARDS[mimicTarget.id].name}」</p>}
        {game.peek?.uid === card.uid && <p className="kj-muted">这是牌堆顶那张（实验室出品，只有你看得到）</p>}
        <div className="gm-panel-actions">
          <button className="quiet-button" type="button" onClick={onClose}>关闭</button>
          {canBuy && (
            <button className="primary-button" type="button" onClick={() => onBuy(card)}>
              买下 {price}⚡{owner ? `（付给 ${owner.name}）` : ""}
            </button>
          )}
          {mine && buyStage && hasCard(game, me, "metamorph") && (
            <button className="quiet-button" type="button" onClick={() => onSell(card.uid)}>卖掉（回合结束得 {def.cost}⚡）</button>
          )}
          {mine && card.id === "rapid-healing" && (
            <button className="quiet-button" type="button" disabled={me.energy < 2 || me.life >= maxLifeOf(game, me)} onClick={onRapidHeal}>快速治疗（2⚡ 回 1 血）</button>
          )}
          {mine && card.id === "mimic" && canAct && myTurn && game.stage === "roll" && game.turnState.rolls === 0 && (
            <button className="quiet-button" type="button" disabled={me.energy < 1} onClick={onMimicMove}>换模仿目标（1⚡）</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MimicPicker({ game, title, exclude, onPick, onCancel }: { game: GameState; title: string; exclude: string | undefined; onPick: (uid: string) => void; onCancel: () => void }) {
  const targets = mimicTargets(game).filter((card) => card.uid !== exclude);
  return (
    <Modal onClose={onCancel} className="kj-picker">
      <h2>{title}</h2>
      {targets.length === 0 ? <p>场上没有能模仿的保留卡。</p> : (
        <div className="kj-pick-list">
          {targets.map((card) => {
            const owner = game.players.find((player) => player.cards.some((candidate) => candidate.uid === card.uid))!;
            return (
              <button key={card.uid} className="kj-pick" type="button" onClick={() => onPick(card.uid)}>
                <img src={cardArt.thumb(card.id)} alt="" />
                <span><b>{CARDS[card.id].name}</b><small>{owner.name} · {CARDS[card.id].text}</small></span>
              </button>
            );
          })}
        </div>
      )}
      <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onCancel}>取消</button></div>
    </Modal>
  );
}

function BatteryPicker({ max, onPick, onCancel }: { max: number; onPick: (amount: number) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(max);
  return (
    <Modal onClose={onCancel} className="kj-picker">
      <h2>往怪兽电池里存多少能量？</h2>
      <p>存进去多少，银行再补同样多；之后每回合开始取出 2 个。</p>
      <div className="kj-stepper">
        <button className="quiet-button" type="button" onClick={() => setAmount((value) => Math.max(0, value - 1))}>−</button>
        <b>{amount}</b>
        <button className="quiet-button" type="button" onClick={() => setAmount((value) => Math.min(max, value + 1))}>＋</button>
        <span>电池里会有 {amount * 2}</span>
      </div>
      <div className="gm-panel-actions">
        <button className="quiet-button" type="button" onClick={onCancel}>取消</button>
        <button className="primary-button" type="button" onClick={() => onPick(amount)}>买下</button>
      </div>
    </Modal>
  );
}

function YieldDialog({ game, nameOf, secondsLeft, onAnswer }: { game: GameState; nameOf: (id: string) => string; secondsLeft: number | null; onAnswer: (yieldSpot: boolean) => void }) {
  const prompt = game.prompt;
  if (prompt?.kind !== "yield") return null;
  const attacker = game.players.find((player) => player.id === prompt.attacker)!;
  const me = game.players.find((player) => player.id === prompt.player)!;
  const twoPlayer = game.players.length === 2;
  return (
    <Modal className="kj-ask">
      <h2>{prompt.jetsBefore ? `${nameOf(attacker.id)} 要打你 ${prompt.damage} 下` : `你在${SPOT_NAME[prompt.spot]}挨了 ${prompt.damage} 下`}</h2>
      <div className="kj-ask-faces">
        <img src={monsterArt.mini(me.monster)} alt="" />
        <img className="kj-ask-claw" src={iconArt.claw} alt="" />
        <img src={monsterArt.mini(attacker.monster)} alt="" />
      </div>
      <p className="kj-ask-life">还剩 <b>{prompt.jetsBefore ? me.life - prompt.damage : me.life}</b> 血{prompt.jetsBefore ? "（如果留下）" : ""}</p>
      <ul className="kj-ask-list">
        <li><b>让位</b>：离开{SPOT_NAME[prompt.spot]}，{nameOf(attacker.id)} 进来{prompt.jetsBefore ? "；你有喷气式，这次伤害不吃" : "，伤害照吃"}。回到城外就能用心回血。</li>
        <li><b>留下</b>：下回合开始 {twoPlayer ? "+1 能量" : "+2 分"}，但继续挨城外所有怪兽的打。</li>
      </ul>
      <div className="gm-panel-actions kj-ask-actions">
        {secondsLeft !== null && <span className="kj-ask-timer">{secondsLeft}s</span>}
        <button className="quiet-button kj-big" type="button" onClick={() => onAnswer(true)} data-tutorial="yield-yes">让位</button>
        <button className="primary-button kj-big" type="button" onClick={() => onAnswer(false)} data-tutorial="yield-no">留下</button>
      </div>
    </Modal>
  );
}

function WingsDialog({ damage, energy, secondsLeft, onAnswer }: { damage: number; energy: number; secondsLeft: number | null; onAnswer: (use: boolean) => void }) {
  return (
    <Modal className="kj-ask">
      <h2>马上要挨 {damage} 点伤害</h2>
      <p>用双翼：花 2 能量（你有 {energy}），这一回合剩下的伤害全免。</p>
      <div className="gm-panel-actions kj-ask-actions">
        {secondsLeft !== null && <span className="kj-ask-timer">{secondsLeft}s</span>}
        <button className="quiet-button kj-big" type="button" onClick={() => onAnswer(false)}>不用</button>
        <button className="primary-button kj-big" type="button" disabled={energy < 2} onClick={() => onAnswer(true)}>用双翼</button>
      </div>
    </Modal>
  );
}

function LogPanel({ game, nameOf }: { game: GameState; nameOf: (id: string) => string }) {
  const lines: { key: string; text: string }[] = [];
  game.recent.forEach((entry, index) => {
    const text = describeEvent(entry.e, nameOf);
    if (text) lines.push({ key: `${entry.v}-${index}`, text });
  });
  lines.reverse();
  return (
    <section className="kj-panel kj-log" data-tutorial="log">
      <h3>战况</h3>
      {lines.length === 0 ? <p className="kj-muted">还没有动作。</p> : <ul>{lines.slice(0, 40).map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
    </section>
  );
}

function FinalDialog({ game, room, selfId, spectating, onRematch, onLeave, actions }: {
  actions?: ReactNode;
  game: GameState;
  room: LobbyRoomSnapshot;
  selfId: string;
  spectating: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const rank = (player: Player) => (result.winners.includes(player.id) ? 2 : 0) + (player.alive ? 1 : 0);
  const rows = [...game.players].sort((a, b) => rank(b) - rank(a) || b.vp - a.vp || b.life - a.life);
  const iWon = selfId !== "" && result.winners.includes(selfId);
  const title = result.winners.length === 0
    ? "全员倒下，没有赢家"
    : iWon ? (result.winners.length > 1 ? "并列获胜！" : "你赢了！") : `${result.winners.map((id) => game.players.find((player) => player.id === id)!.name).join("、")} 获胜`;
  const how = result.reason === "vp" ? "先到 20 分" : result.reason === "lastStanding" ? "打倒了所有对手" : "同归于尽";
  return (
    <Modal className="kj-final">
      {result.winners.length > 0 && <img className="kj-final-trophy" src={iconArt.trophy} alt="" />}
      <h2>{title}</h2>
      <p className="kj-muted">{how}</p>
      <ol className="kj-standings">
        {rows.map((player) => (
          <li key={player.id} className={result.winners.includes(player.id) ? "winner" : player.alive ? "" : "dead"} style={{ "--seat": MONSTERS[player.monster].hex } as CSSProperties}>
            <img src={player.alive ? monsterArt.mini(player.monster) : monsterArt.ko(player.monster)} alt="" />
            <strong>{player.name}{player.id === selfId ? "（你）" : ""}</strong>
            <span className="kj-stat vp"><img src={iconArt.star} alt="分数" /><b>{player.vp}</b></span>
            <span className="kj-stat life"><img src={iconArt.heart} alt="生命" /><b>{player.alive ? player.life : "出局"}</b></span>
          </li>
        ))}
      </ol>
      {actions ? (
        <div className="kj-rematch"><div className="gm-panel-actions">{actions}</div></div>
      ) : spectating ? (
        <div className="kj-rematch">
          <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length}）` : "对局结束"}</span>
          <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
        </div>
      ) : room.rematch && (
        <div className="kj-rematch">
          <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
          <div className="gm-panel-actions">
            <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
            <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default GameBoard;
