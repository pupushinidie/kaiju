import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  actorId,
  buildState,
  legalActions,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type ServerToClientEvents,
} from "@kaiju/game";

// 人机立刻行动、每一步 300 ms 超时（服务端在导入时读这两个变量）。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "300";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let server: typeof import("../src/index.js");
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}
const nick = (prefix: string) => `${prefix}${(nameSeq += 1)}`;
function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}
function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 30_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) return resolve(current);
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}
const seatOf = (client: TestSocket) => latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";

/** 轮到自己（包括被问让位、双翼）就随机走一步合法动作；返回停止函数。 */
function autoplay(client: TestSocket, pick: (game: GameState, actions: GameCommand[]) => GameCommand): () => void {
  let sentFor = -1;
  const handler = (room: LobbyRoomSnapshot) => {
    const game = room.game;
    if (!game || game.phase === "finished") return;
    const seat = seatOf(client);
    if (actorId(game) !== seat || sentFor === game.version) return;
    const actions = legalActions(game, seat).filter((action) => action.type !== "RAPID_HEAL");
    if (actions.length === 0) return;
    sentFor = game.version;
    client.emit("game:command", pick(game, actions), () => {});
  };
  client.on("room:updated", handler);
  const current = latest.get(client);
  if (current) handler(current);
  return () => client.off("room:updated", handler);
}
const randomPick = (_game: GameState, actions: GameCommand[]) => actions[Math.floor(Math.random() * actions.length)]!;

/** 抓包：一位玩家收到的对局里有没有不该看到的东西。 */
function leaks(game: GameState, viewer: string, full: GameState | undefined): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(game);
  if (game.deck.length > 0) problems.push("牌堆下发了");
  for (const key of ["seed", "rngState", "log"]) if (key in game) problems.push(`下发了 ${key}`);
  if (game.peek) {
    const me = game.players.find((player) => player.id === viewer);
    const buyer = game.players[game.currentPlayer];
    if (!me || buyer?.id !== viewer || game.stage !== "buy" || !me.cards.some((card) => card.id === "made-in-a-lab" || card.id === "mimic")) problems.push("别人看到了牌堆顶");
  }
  if (full) {
    // 牌堆里的卡（除了自己能看的牌堆顶）一张都不该出现
    const hidden = full.deck.slice(game.peek ? 1 : 0);
    for (const card of hidden) if (text.includes(`"${card.uid}"`)) problems.push(`牌堆里的 ${card.uid} 漏了`);
  }
  return problems;
}

describe("房间流程和对局", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("建房 → 选怪兽（不能撞）→ 加入 → 开局 → 随机打到终局（抓包没有泄露）→ 再来一局", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 3 } as never, ack));
    expect(created.ok).toBe(true);
    const code = created.ok ? created.data.code : "";
    expect((await call<void>((ack) => host.emit("room:monster", "crab", ack))).ok).toBe(true);
    const guest = await connect();
    const third = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => third.emit("room:join", { name: nick("三号"), code }, ack))).ok).toBe(true);
    expect((await call<void>((ack) => guest.emit("room:monster", "crab", ack))).ok).toBe(false);
    expect((await call<void>((ack) => guest.emit("room:monster", "jelly", ack))).ok).toBe(true);
    expect((await call<void>((ack) => guest.emit("room:monster", "nope" as never, ack))).ok).toBe(false);
    await updateWhere(host, (room) => room.members.some((member) => member.monster === "jelly"));

    // 抓包：记下客人收到的每一条
    const problems: string[] = [];
    let packets = 0;
    guest.on("room:updated", (room) => {
      if (!room.game) return;
      packets += 1;
      problems.push(...leaks(room.game, seatOf(guest), server.testHooks.getGame(code)));
    });

    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    const started = await updateWhere(guest, (room) => room.game !== undefined);
    const monsters = Object.fromEntries(started.game!.players.map((player) => [player.name, player.monster]));
    expect(Object.values(monsters)).toContain("crab");
    expect(Object.values(monsters)).toContain("jelly");
    expect(started.game!.players.find((player) => player.monster === "crab")!.id).toBe(seatOf(host));

    const stops = [host, guest, third].map((client) => autoplay(client, randomPick));
    const finished = await updateWhere(host, (room) => room.game?.phase === "finished", 90_000);
    stops.forEach((stop) => stop());
    expect(finished.game!.finalResult).toBeDefined();
    expect(packets).toBeGreaterThan(5);
    expect(problems.slice(0, 3)).toEqual([]);

    // 再来一局
    for (const client of [host, guest, third]) client.emit("room:rematch", true, () => {});
    const again = await updateWhere(host, (room) => room.game?.phase === "playing" && room.game.version < 3);
    expect(again.game!.players.every((player) => player.life === 10 && player.vp === 0)).toBe(true);
  }, 120_000);

  it("超时：掷骰不重掷直接结算、让位默认留下、买牌直接结束；连续超时转托管，托管的人机把局打完", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("挂机"), capacity: 2 } as never, ack));
    const code = created.ok ? created.data.code : "";
    const guest = await connect();
    await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("对手"), code }, ack));
    await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    await updateWhere(host, (room) => room.game !== undefined);
    const hostSeat = seatOf(host);
    const guestSeat = seatOf(guest);
    // 摆一个让位局面：host 在城心，guest 正要结算两只爪
    const ids = [hostSeat, guestSeat].sort();
    const state = buildState({ players: 2, current: ids.indexOf(guestSeat), dice: ["claw", "claw", "1", "2", "3", "energy"], rolls: 3, rollsLeft: 0, p: { [ids.indexOf(hostSeat)]: { location: "city" } } });
    state.players = state.players.map((player, seat) => ({ ...player, id: ids[seat]! }));
    state.city = hostSeat;
    state.turnState = { ...state.turnState, player: guestSeat };
    server.testHooks.setGame(code, state);
    await updateWhere(guest, (room) => room.game?.version === state.version);
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("game:command", { type: "RESOLVE" }, ack))).ok).toBe(true);
    const asked = await updateWhere(host, (room) => room.game?.prompt?.kind === "yield");
    expect(asked.game!.prompt!.player).toBe(hostSeat);
    expect(asked.turnRemainingMs).toBeGreaterThan(0);
    // host 不理：超时留下
    const stayed = await updateWhere(host, (room) => room.game?.events.some((event) => event.type === "TurnTimedOut" && event.stage === "yield") === true);
    expect(stayed.game!.city).toBe(hostSeat);
    // guest 也不动：买牌超时结束回合，轮到 host；host 继续不动 → 掷骰超时直接结算
    const hostTurn = await updateWhere(host, (room) => room.game?.events.some((event) => event.type === "TurnTimedOut" && event.stage === "roll" && event.player === hostSeat) === true);
    expect(hostTurn.game!.turnState.resolved || hostTurn.game!.turnState.player !== hostSeat).toBe(true);
    // 两次超时转托管
    await updateWhere(host, (room) => room.members.some((member) => member.playerId === hostSeat && member.auto === true));
    // guest 自己走，host 托管：局能打完
    const stop = autoplay(guest, randomPick);
    const done = await updateWhere(guest, (room) => room.game?.phase === "finished", 90_000);
    stop();
    expect(done.game!.finalResult).toBeDefined();
  }, 120_000);

  it("掉线后用原昵称加房间码回到原座位", async () => {
    const host = await connect();
    const name = nick("回来");
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name, capacity: 2 } as never, ack));
    const code = created.ok ? created.data.code : "";
    const guest = await connect();
    await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("对手"), code }, ack));
    await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    await updateWhere(host, (room) => room.game !== undefined);
    const seat = seatOf(host);
    host.disconnect();
    await updateWhere(guest, (room) => room.members.some((member) => member.playerId === seat && !member.connected));
    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name, code }, ack));
    expect(rejoined.ok).toBe(true);
    await updateWhere(back, (room) => room.game !== undefined);
    expect(seatOf(back)).toBe(seat);
  }, 60_000);
});
