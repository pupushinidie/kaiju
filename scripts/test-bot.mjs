// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
// 机器人轮到自己（包括被问让位、双翼）时用 botCommand 决定（第 3 步之前是随机合法动作）。
// 环境变量：BOT_DELAY_MS 每步思考时间（默认 1200）；BOT_IDLE=1 只挂着不动（等超时自动处理）；
// SERVER_URL、SOCKET_PATH 连别的服务器（默认 http://localhost:3026）；BOT_REMATCH=1 终局后同意再来一局并继续打。
import { io } from "socket.io-client";
import { actorId, botCommand } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3026";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1200);
const IDLE = process.env.BOT_IDLE === "1";
const REMATCH = process.env.BOT_REMATCH === "1";
const NAMES = ["鹿鹿", "冻冻", "罐罐", "云云", "墩墩", "蟹蟹"];

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  let rematchedFor = -1;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉轮到自己。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase === "finished" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat || actorId(game) !== seat) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const fresh = latest?.game;
      if (fresh && fresh.phase !== "finished" && actorId(fresh) === seat) {
        const command = botCommand(fresh, seat);
        if (command) {
          const result = await emit("game:command", command);
          if (!result.ok) console.log(name, "行动失败", result.error, JSON.stringify(command));
        }
      }
    } finally {
      acting = false;
    }
    if (latest !== room) void tick();
  }
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "finished") {
      if (rematchedFor !== game.version) {
        rematchedFor = game.version;
        const scores = game.players.map((player) => `${player.name}:${player.vp}分${player.alive ? "" : "(出局)"}`).join(" ");
        const winners = game.finalResult?.winners.map((id) => game.players.find((player) => player.id === id)?.name).join("、") || "无";
        console.log(name, "游戏结束", scores, "胜者", winners);
        if (REMATCH) void emit("room:rematch", true);
        else setTimeout(() => process.exit(0), 200);
      }
      return;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const { socket, emit } = bot(arg2 ?? NAMES[1]);
  socket.on("connect", async () => console.log("join", (await emit("room:join", { name: arg2 ?? NAMES[1], code: arg1 })).ok));
} else {
  const capacity = Number(arg1 ?? 2);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
