/**
 * 巨兽之城和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botDecision, CARDS, type GameState } from "@kaiju/game";
import { FACE_NAME } from "./describe.js";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "kaiju";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个按钮（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

/** 「提示」：让人机从你的位置算一步（它本来就只看你能看到的信息），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const decision = botDecision(game, playerId);
  if (!decision) return { say: "等别人走完再问我。", anchor: null };
  const { command, reason } = decision;
  const note = reason;
  switch (command.type) {
    case "ROLL": {
      if (game.turnState.rolls === 0) return { say: "先掷骰子。", anchor: "roll-button" };
      const keep = command.keep ?? [];
      const faces = keep.map((index) => FACE_NAME[game.turnState.dice[index]!.face!]).join("、");
      const say = command.use === "smoke" ? "我会用烟雾再掷一次。" : command.use === "telepath" ? "我会花 1 能量再掷一次。" : keep.length > 0 ? `我会留下 ${faces}，重掷其余的。` : "我会全部重掷。";
      return { say, note, anchor: "dice" };
    }
    case "RESOLVE":
      return { say: "我会直接结算。", note, anchor: "resolve-button" };
    case "CHANGE_DIE":
      return { say: "我会改一颗骰子。", note, anchor: "dice" };
    case "MIMIC":
      return { say: "我会先换模仿目标。", note, anchor: "actions" };
    case "YIELD":
      return command.yield ? { say: "我会让位。", note, anchor: "yield-yes" } : { say: "我会留下。", note, anchor: "yield-no" };
    case "WINGS":
      return { say: command.use ? "我会用双翼。" : "我不用双翼。", note, anchor: null };
    case "BUY": {
      const slot = game.market.findIndex((card) => card?.uid === command.uid);
      const card = game.market[slot] ?? game.peek ?? game.players.flatMap((player) => player.cards).find((entry) => entry.uid === command.uid);
      return { say: `我会买「${card ? CARDS[card.id].name : "这张卡"}」。`, note, anchor: slot >= 0 ? `buy-${slot}` : null };
    }
    case "SWEEP":
      return { say: "我会花 2 能量换一批卡。", note, anchor: "sweep" };
    case "SELL":
      return { say: "我会卖掉一张卡。", note, anchor: "my-panel" };
    case "RAPID_HEAL":
      return { say: "我会先用快速治疗。", note, anchor: "my-panel" };
    case "END_TURN":
      return { say: "我会结束回合。", note, anchor: "end-turn" };
  }
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  entered: { title: "你进城心了", text: "回合开始还在城心 +2 分；但城外所有怪兽的爪都打你，心也不能回血。" },
  "yield-ask": { title: "在城心挨了爪", text: "可以让位：城心让给打你的怪兽，伤害照吃，回城外就能回血。血少时别硬撑。" },
  "card-damage": { title: "卡牌伤害不能让位", text: "瓦斯精炼厂、火焰冲击这类卡造成的伤害不算攻击，挨了也不能让位。" },
  poison: { title: "你中毒了", text: "回合结束时每个中毒标记掉 1 血；在城外结算心时，一颗心去掉一个标记。" },
  shrink: { title: "你被缩小了", text: "每个缩小标记少掷 1 颗骰；在城外结算心时，一颗心去掉一个标记。" },
  "ko-other": { title: "有怪兽倒下了", text: "它的卡和能量全部弃掉。场上只剩最后一只怪兽时，那只直接获胜。" },
  "near-win": { title: "快到 20 分了", text: "到 20 分要撑过这个回合才算赢：同一回合被打到 0 血就不算。" },
  "two-player": { title: "2 人局", text: "进城心、回合开始在城心给 1 能量，不给分。想赢多半要把对方打倒。" },
  bay: { title: "港湾开着", text: "5–6 人局多一个港湾，也算在城里；城心和港湾的怪兽互不打。只剩 4 只时港湾关闭。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  for (const event of game.events) {
    if (event.type === "Entered" && event.player === selfId) ids.push(game.players.length === 2 ? "two-player" : "entered");
    if (event.type === "Entered" && event.spot === "bay") ids.push("bay");
    if (event.type === "Damaged" && event.player === selfId && !event.attack && event.amount > 0 && event.source !== selfId) {
      const me = game.players.find((player) => player.id === selfId);
      if (me?.location) ids.push("card-damage");
    }
    if (event.type === "TokenAdded" && event.player === selfId) ids.push(event.token === "poison" ? "poison" : "shrink");
    if (event.type === "Eliminated" && event.player !== selfId) ids.push("ko-other");
  }
  if (game.prompt?.kind === "yield" && game.prompt.player === selfId) ids.push("yield-ask");
  const me = game.players.find((player) => player.id === selfId);
  if (me && me.alive && me.vp >= 16) ids.push("near-win");
  return ids;
}
