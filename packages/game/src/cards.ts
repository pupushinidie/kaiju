/**
 * 63 张超能力卡（61 种）。补充文件第四节的 66 张去掉治疗射线、投机者、读心探针（开工拍板）。
 * id 和美术文件名一致（apps/web/public/art/cards/full/<id>.png）。效果文字是界面上显示的，用自己的话写。
 */
export type CardKind = "keep" | "discard";

export interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly kind: CardKind;
  readonly cost: number;
  readonly copies: number;
  /** 卡面效果（短）。 */
  readonly text: string;
}

const D = "discard" as const;
const K = "keep" as const;

export const CARD_LIST = [
  // ---- 一次性 17 种 18 张 ----
  { id: "apartment-building", name: "公寓大楼", kind: D, cost: 5, copies: 1, text: "+3 分" },
  { id: "commuter-train", name: "通勤列车", kind: D, cost: 4, copies: 1, text: "+2 分" },
  { id: "corner-store", name: "街角小店", kind: D, cost: 3, copies: 1, text: "+1 分" },
  { id: "drop-from-high-altitude", name: "高空坠落", kind: D, cost: 5, copies: 1, text: "+2 分，并占领城心（原来的怪兽被挤出去）" },
  { id: "energize", name: "充能", kind: D, cost: 8, copies: 1, text: "+9 能量" },
  { id: "evacuation-orders", name: "疏散令", kind: D, cost: 7, copies: 2, text: "其他怪兽各 -5 分" },
  { id: "fire-blast", name: "火焰冲击", kind: D, cost: 3, copies: 1, text: "其他怪兽各受 2 伤害" },
  { id: "frenzy", name: "狂暴", kind: D, cost: 7, copies: 1, text: "这回合结束后再来一个回合" },
  { id: "gas-refinery", name: "瓦斯精炼厂", kind: D, cost: 6, copies: 1, text: "+2 分，其他怪兽各受 3 伤害" },
  { id: "heal", name: "治疗", kind: D, cost: 3, copies: 1, text: "回 2 血" },
  { id: "high-altitude-bombing", name: "高空轰炸", kind: D, cost: 4, copies: 1, text: "所有怪兽（包括自己）各受 3 伤害" },
  { id: "jet-fighters", name: "战斗机", kind: D, cost: 5, copies: 1, text: "+5 分，自己受 4 伤害" },
  { id: "national-guard", name: "国民警卫队", kind: D, cost: 3, copies: 1, text: "+2 分，自己受 2 伤害" },
  { id: "nuclear-power-plant", name: "核电站", kind: D, cost: 6, copies: 1, text: "+2 分，回 3 血" },
  { id: "skyscraper", name: "摩天楼", kind: D, cost: 6, copies: 1, text: "+4 分" },
  { id: "tanks", name: "坦克", kind: D, cost: 4, copies: 1, text: "+4 分，自己受 3 伤害" },
  { id: "vast-storm", name: "大风暴", kind: D, cost: 6, copies: 1, text: "+2 分；其他怪兽每有 2 能量丢 1 能量" },
  // ---- 保留 44 种 45 张 ----
  { id: "acid-attack", name: "酸液攻击", kind: K, cost: 6, copies: 1, text: "每回合攻击多 1 伤害，没掷出爪也照样打" },
  { id: "alien-metabolism", name: "外星新陈代谢", kind: K, cost: 3, copies: 1, text: "买卡便宜 1 能量" },
  { id: "alpha-monster", name: "头号怪兽", kind: K, cost: 5, copies: 1, text: "每次攻击 +1 分" },
  { id: "armor-plating", name: "装甲板", kind: K, cost: 4, copies: 1, text: "一次只受 1 点伤害时，免掉它" },
  { id: "background-dweller", name: "背景住户", kind: K, cost: 4, copies: 1, text: "掷出的 3 随时可以免费重掷" },
  { id: "burrowing", name: "钻地", kind: K, cost: 5, copies: 1, text: "在城里攻击多 1 伤害；让位时接替你的怪兽受 1 伤害" },
  { id: "camouflage", name: "伪装", kind: K, cost: 3, copies: 1, text: "受伤时每点伤害掷一颗骰，掷出心就免掉 1 点" },
  { id: "complete-destruction", name: "彻底破坏", kind: K, cost: 3, copies: 1, text: "骰面六种全有：+9 分" },
  { id: "dedicated-news-team", name: "专属新闻组", kind: K, cost: 3, copies: 1, text: "之后每买一张卡 +1 分" },
  { id: "eater-of-the-dead", name: "食尸者", kind: K, cost: 4, copies: 1, text: "每有一只怪兽倒下（生命到 0）+3 分" },
  { id: "energy-hoarder", name: "能量囤积者", kind: K, cost: 3, copies: 1, text: "回合结束时每有 6 能量 +1 分" },
  { id: "even-bigger", name: "更巨大", kind: K, cost: 4, copies: 1, text: "生命上限 +2；买下时回 2 血" },
  { id: "extra-head", name: "额外脑袋", kind: K, cost: 7, copies: 2, text: "多掷 1 颗骰" },
  { id: "fire-breathing", name: "喷火", kind: K, cost: 4, copies: 1, text: "你造成伤害时，左右邻座各多受 1 伤害" },
  { id: "freeze-time", name: "冻结时间", kind: K, cost: 5, copies: 1, text: "计分三个 1：回合结束后再来一回合，少掷 1 颗骰" },
  { id: "friend-of-children", name: "孩子们的朋友", kind: K, cost: 3, copies: 1, text: "每次得能量时多得 1" },
  { id: "giant-brain", name: "巨脑", kind: K, cost: 5, copies: 1, text: "每回合多重掷 1 次" },
  { id: "gourmet", name: "美食家", kind: K, cost: 4, copies: 1, text: "计分三个 1 时多 +2 分" },
  { id: "herbivore", name: "草食动物", kind: K, cost: 5, copies: 1, text: "自己回合没伤害任何怪兽：+1 分" },
  { id: "herd-culler", name: "剔除弱者", kind: K, cost: 3, copies: 1, text: "每回合一次，把一颗骰改成 1" },
  { id: "it-has-a-child", name: "它有个孩子", kind: K, cost: 7, copies: 1, text: "倒下时改为：弃掉所有卡、分数清零、回满 10 血继续" },
  { id: "jets", name: "喷气式", kind: K, cost: 5, copies: 1, text: "让位时不受这次伤害" },
  { id: "made-in-a-lab", name: "实验室出品", kind: K, cost: 2, copies: 1, text: "买牌时能看牌堆顶一张，也能买它" },
  { id: "metamorph", name: "变形", kind: K, cost: 3, copies: 1, text: "买牌时可以卖掉自己的保留卡，按价格换能量（回合结束到账）" },
  { id: "mimic", name: "模仿", kind: K, cost: 8, copies: 1, text: "选场上一张保留卡，当作自己也有；回合开始花 1 能量可换" },
  { id: "monster-batteries", name: "怪兽电池", kind: K, cost: 2, copies: 1, text: "买时存入能量，银行再补同样多；每回合开始取 2" },
  { id: "nova-breath", name: "新星吐息", kind: K, cost: 7, copies: 1, text: "你的攻击打所有其他怪兽" },
  { id: "omnivore", name: "杂食动物", kind: K, cost: 4, copies: 1, text: "每回合一次，1、2、3 各一颗：+2 分" },
  { id: "parasitic-tentacles", name: "寄生触手", kind: K, cost: 4, copies: 1, text: "可以按价格买别的怪兽的保留卡，能量付给它" },
  { id: "plot-twist", name: "剧情反转", kind: K, cost: 3, copies: 1, text: "把一颗骰改成任意面，用后弃掉" },
  { id: "poison-quills", name: "毒刺", kind: K, cost: 3, copies: 1, text: "计分三个 2 时，攻击多 2 伤害" },
  { id: "poison-spit", name: "毒液", kind: K, cost: 4, copies: 1, text: "你造成伤害时，给对方 1 个中毒标记" },
  { id: "rapid-healing", name: "快速治疗", kind: K, cost: 3, copies: 1, text: "任何时候花 2 能量回 1 血" },
  { id: "regeneration", name: "再生", kind: K, cost: 4, copies: 1, text: "回血时多回 1" },
  { id: "rooting-for-the-underdog", name: "为弱者加油", kind: K, cost: 3, copies: 1, text: "回合结束时分数最少（并列也算）：+1 分" },
  { id: "shrink-ray", name: "缩小射线", kind: K, cost: 6, copies: 1, text: "你造成伤害时，给对方 1 个缩小标记" },
  { id: "smoke-cloud", name: "烟雾", kind: K, cost: 4, copies: 1, text: "3 个烟雾标记，每个换一次额外重掷，用完弃掉" },
  { id: "solar-powered", name: "太阳能", kind: K, cost: 2, copies: 1, text: "回合结束时能量为 0：+1 能量" },
  { id: "spiked-tail", name: "尖刺尾巴", kind: K, cost: 5, copies: 1, text: "攻击时多 1 伤害" },
  { id: "stretchy", name: "弹性", kind: K, cost: 3, copies: 1, text: "花 2 能量，把一颗骰改成任意面" },
  { id: "telepath", name: "心灵感应", kind: K, cost: 4, copies: 1, text: "花 1 能量多重掷 1 次" },
  { id: "urbavore", name: "城市吞噬者", kind: K, cost: 4, copies: 1, text: "回合开始在城里多 +1 分；在城里造成伤害多 1" },
  { id: "were-only-making-it-stronger", name: "越打越强", kind: K, cost: 3, copies: 1, text: "一次掉 2 血或更多：+1 能量" },
  { id: "wings", name: "双翼", kind: K, cost: 6, copies: 1, text: "挨打时花 2 能量，这回合不再受伤害" },
] as const satisfies readonly CardDef[];

export type CardId = (typeof CARD_LIST)[number]["id"];

export const CARDS: Readonly<Record<CardId, CardDef>> = Object.fromEntries(CARD_LIST.map((card) => [card.id, card])) as Record<CardId, CardDef>;

export function cardDef(id: CardId): CardDef {
  return CARDS[id];
}

/** 一副牌：63 张，uid 是 c01…c63。 */
export function fullDeck(): { uid: string; id: CardId }[] {
  const deck: { uid: string; id: CardId }[] = [];
  for (const card of CARD_LIST) {
    for (let copy = 0; copy < card.copies; copy += 1) {
      deck.push({ uid: `c${String(deck.length + 1).padStart(2, "0")}`, id: card.id });
    }
  }
  return deck;
}

export const DECK_SIZE = 63;

/** 不能被模仿的卡：带消耗状态的（烟雾、电池、剧情反转）和模仿本身。 */
export const UNMIMICABLE: readonly CardId[] = ["mimic", "smoke-cloud", "monster-batteries", "plot-twist"];
