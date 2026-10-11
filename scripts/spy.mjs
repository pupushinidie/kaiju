// 抓包脚本：连上真实服务器（先 npm run dev），两个 socket 建房、加入、开局，用人机策略打完一局，
// 记录发给「乙」的每一条 room:updated，检查里面有没有牌堆顺序、种子、随机数状态、动作序列，
// 以及「实验室出品」的牌堆顶是不是只发给了正在买牌的主人本人。
//   node scripts/spy.mjs [人数，默认 2]    环境变量 SERVER_URL（默认 http://localhost:3026）
import { io } from "socket.io-client";
import { actorId, botCommand } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3026";
const capacity = Number(process.argv[2] ?? 2);
const problems = [];
let packets = 0;
const sockets = [];

function client(name, spy) {
  const socket = io(URL, { transports: ["websocket"] });
  sockets.push(socket);
  let latest = null;
  let acting = false;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  async function tick() {
    const game = latest?.game;
    if (!game || game.phase === "finished" || acting) return;
    const seat = latest.members.find((member) => member.id === socket.id)?.playerId;
    if (actorId(game) !== seat) return;
    acting = true;
    try {
      const command = botCommand(game, seat);
      if (command) await emit("game:command", command);
    } finally {
      acting = false;
    }
    void tick();
  }
  socket.on("room:updated", (room) => {
    latest = room;
    if (spy && room.game) {
      packets += 1;
      const game = room.game;
      const seat = room.members.find((member) => member.id === socket.id)?.playerId;
      if (Array.isArray(game.deck) && game.deck.length > 0) problems.push(`v${game.version} 下发了牌堆 ${game.deck.length} 张`);
      for (const key of ["seed", "rngState", "log"]) if (key in game) problems.push(`v${game.version} 下发了 ${key}`);
      if (game.peek) {
        const buyer = game.players[game.currentPlayer];
        if (buyer?.id !== seat || game.stage !== "buy") problems.push(`v${game.version} 别人看到了牌堆顶`);
      }
    }
    if (room.game?.phase === "finished") {
      finish(room.game);
      return;
    }
    void tick();
  });
  return { socket, emit };
}

let done = false;
function finish(game) {
  if (done) return;
  done = true;
  console.log(`收到 ${packets} 条对局状态；终局：${game.finalResult?.reason}`);
  if (problems.length === 0) console.log("抓包通过：没有牌堆顺序、种子、随机数状态、动作序列，牌堆顶没有发给别人");
  else console.log("发现泄露：\n" + [...new Set(problems)].slice(0, 20).join("\n"));
  for (const socket of sockets) socket.disconnect();
  process.exit(problems.length === 0 ? 0 : 1);
}

const host = client("甲", false);
host.socket.on("connect", async () => {
  const created = await host.emit("room:create", { name: `抓包甲${Date.now() % 1000}`, capacity });
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  const spy = client("乙", true);
  spy.socket.on("connect", async () => {
    const joined = await spy.emit("room:join", { name: `抓包乙${Date.now() % 1000}`, code });
    if (!joined.ok) throw new Error(joined.error);
    for (let seat = 2; seat < capacity; seat += 1) await host.emit("room:add-bot");
    const started = await host.emit("room:start");
    if (!started.ok) throw new Error(started.error);
    console.log("房间", code, "已开局");
  });
});
setTimeout(() => {
  console.log("超时：10 分钟还没打完");
  process.exit(2);
}, 600_000).unref();
