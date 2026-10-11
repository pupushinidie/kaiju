// 对局事件 → 日志里的一句话（用界面上的中文名词）。
import { CARDS, type Face, type GameEvent, type Spot } from "@kaiju/game";

export const SPOT_NAME: Record<Spot, string> = { city: "城心", bay: "港湾" };
export const FACE_NAME: Record<Face, string> = { "1": "1", "2": "2", "3": "3", energy: "闪电", heart: "心", claw: "爪" };

const VP_REASON: Record<string, string> = {
  dice: "骰子", enter: "进城", startInCity: "坐镇城里", card: "卡牌", alpha: "头号怪兽", omnivore: "杂食动物",
  gourmet: "美食家", destruction: "彻底破坏", news: "专属新闻组", eater: "食尸者", hoarder: "能量囤积者",
  underdog: "为弱者加油", herbivore: "草食动物", urbavore: "城市吞噬者",
};
const ENERGY_REASON: Record<string, string> = {
  dice: "骰子", enter: "进城", startInCity: "坐镇城里", card: "卡牌", battery: "怪兽电池", solar: "太阳能",
  stronger: "越打越强", metamorph: "变形卖卡",
};

export function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "TurnStarted":
      return event.extra === "frenzy" ? `${name(event.player)} 狂暴，再来一回合` : event.extra === "freeze" ? `${name(event.player)} 冻结时间，再来一回合` : null;
    case "Rolled":
      return null;
    case "Resolved":
      return `${name(event.player)} 结算：${event.dice.map((face) => FACE_NAME[face]).join(" ") || "没有骰子"}`;
    case "DieChanged":
      return `${name(event.player)} 用${CARDS[event.via as keyof typeof CARDS]?.name ?? "卡"}把一颗骰子改成 ${FACE_NAME[event.face]}`;
    case "Vp":
      return `${name(event.player)} +${event.amount} 分（${event.card ? CARDS[event.card].name : VP_REASON[event.reason] ?? ""}）`;
    case "Energy":
      return `${name(event.player)} +${event.amount} 能量（${ENERGY_REASON[event.reason] ?? "卡牌"}）`;
    case "Healed":
      return `${name(event.player)} 回 ${event.amount} 血`;
    case "TokenRemoved":
      return `${name(event.player)} 去掉 ${event.count} 个${event.token === "poison" ? "中毒" : "缩小"}标记`;
    case "TokenAdded":
      return `${name(event.player)} 中了 1 个${event.token === "poison" ? "中毒" : "缩小"}标记`;
    case "Attack":
      return `${name(event.player)} 攻击 ${event.damage} 点`;
    case "Damaged":
      if (event.amount === 0) return `${name(event.player)} 挡住了伤害（${event.blockedBy === "wings" ? "双翼" : event.blockedBy === "armor-plating" ? "装甲板" : "伪装"}）`;
      return `${name(event.player)} 掉 ${event.amount} 血${event.blocked ? `（伪装挡掉 ${event.blocked}）` : ""}`;
    case "LifeLost":
      return `${name(event.player)} ${event.reason === "poison" ? "中毒" : "失去更巨大"}，掉 ${event.amount} 血`;
    case "Entered":
      return event.how === "bayClosed" ? `港湾关闭，${name(event.player)} 移进城心` : `${name(event.player)} 进入${SPOT_NAME[event.spot]}`;
    case "Yielded":
      return `${name(event.player)} 让出${SPOT_NAME[event.spot]}`;
    case "Stayed":
      return `${name(event.player)} 留在${SPOT_NAME[event.spot]}`;
    case "Left":
      return event.reason === "pushed" ? `${name(event.player)} 被挤出城心` : event.reason === "bayClosed" ? `港湾关闭，${name(event.player)} 回到城外` : null;
    case "Eliminated":
      return `${name(event.player)} 倒下了`;
    case "Reborn":
      return `${name(event.player)} 的孩子接着战斗（卡和分数清零，回满血）`;
    case "Bought":
      return `${name(event.player)} 花 ${event.cost} 能量买了「${CARDS[event.card].name}」`;
    case "Swept":
      return `${name(event.player)} 花 2 能量换了一批卡`;
    case "Sold":
      return `${name(event.player)} 卖掉「${CARDS[event.card].name}」，回合结束得 ${event.energy} 能量`;
    case "CardDiscarded":
      return event.reason === "used" || event.reason === "empty" ? `「${CARDS[event.card].name}」用完弃掉` : null;
    case "WingsUsed":
      return `${name(event.player)} 展开双翼，这回合不再受伤`;
    case "MimicSet":
      return `${name(event.player)} 模仿了「${CARDS[event.card].name}」`;
    case "EnergyLost":
      return `${name(event.player)} 丢了 ${event.amount} 能量`;
    case "VpLost":
      return `${name(event.player)} 丢了 ${event.amount} 分`;
    case "BayClosed":
      return "只剩 4 只怪兽，港湾关闭";
    case "TurnTimedOut":
      return `${name(event.player)} 超时，${event.stage === "yield" ? "留在城里" : event.stage === "wings" ? "没用双翼" : event.stage === "buy" ? "结束回合" : "直接结算"}`;
    case "GameEnded":
      return event.winners.length === 0 ? "全员倒下，没有赢家" : `${event.winners.map(name).join("、")} 获胜`;
  }
}
