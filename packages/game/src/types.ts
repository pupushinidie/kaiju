import type { CardId } from "./cards.js";

/** 六只原创怪兽（属性完全一样，只有外观不同）。 */
export const MONSTER_IDS = ["deer", "jelly", "robot", "cloud", "moss", "crab"] as const;
export type MonsterId = (typeof MONSTER_IDS)[number];

/** 骰子的六种面。 */
export const FACES = ["1", "2", "3", "energy", "heart", "claw"] as const;
export type Face = (typeof FACES)[number];

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 获胜分数（20）。 */
  readonly winVp: number;
  /** 生命上限（10，「更巨大」每张 +2）。 */
  readonly maxLife: number;
  /** 2 人局：进城 / 回合开始在城里给能量不给分（开工拍板：默认开）。 */
  readonly twoPlayerEnergy: boolean;
  /** 各步限时（秒）：掷骰 40、让位 20、买牌 30、挨打时用卡（双翼）10。 */
  readonly rollTimeoutSec: number;
  readonly yieldTimeoutSec: number;
  readonly buyTimeoutSec: number;
  readonly reactTimeoutSec: number;
}

/** 一张实体卡（同名卡有两份时 uid 不同）。 */
export interface CardInstance {
  readonly uid: string;
  readonly id: CardId;
  /** 烟雾：剩下的烟雾标记。 */
  smoke?: number;
  /** 怪兽电池：卡上存的能量。 */
  battery?: number;
  /** 模仿：模仿标记放在哪张卡上（那张卡的 uid）。 */
  mimic?: string;
}

/** 城心（2–6 人都有）和港湾（5–6 人加用）。 */
export type Spot = "city" | "bay";

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位顺序（0 起），也是队伍色下标。 */
  readonly seat: number;
  readonly monster: MonsterId;
  life: number;
  vp: number;
  energy: number;
  alive: boolean;
  /** 在城心 / 港湾，还是在城外（null）。 */
  location: Spot | null;
  /** 面前的 KEEP 卡。 */
  cards: CardInstance[];
  poison: number;
  shrink: number;
  /** 双翼生效中：这一回合（当前玩家的回合）剩下的伤害都免掉。 */
  wingsActive?: boolean;
}

export interface Die {
  /** null = 还没掷。 */
  face: Face | null;
  /** 额外脑袋加的绿骰。 */
  readonly green: boolean;
}

/**
 * roll：当前玩家掷骰、留骰、重掷、改骰，最后结算；
 * prompt：等某位玩家回答一个问题（让位、双翼），见 GameState.prompt；
 * buy：买牌 / 扫牌 / 卖牌（变形），然后结束回合。
 */
export type Stage = "roll" | "prompt" | "buy";

export type Prompt =
  /** 在城心 / 港湾挨了爪：让位还是留下。jetsBefore = 有「喷气式」，伤害还没吃（让位就不吃）。 */
  | {
      readonly kind: "yield";
      readonly player: string;
      readonly attacker: string;
      readonly spot: Spot;
      readonly damage: number;
      readonly jetsBefore?: boolean;
    }
  /** 马上要挨 damage 点伤害，有「双翼」：要不要花 2 能量免掉（这一回合剩下的伤害都免）。 */
  | { readonly kind: "wings"; readonly player: string; readonly source: string; readonly damage: number };

export interface Hit {
  readonly target: string;
  readonly amount: number;
  /** 这一下已经问过双翼 / 喷气式让位了。 */
  readonly wingsAsked?: boolean;
  readonly jetsAsked?: boolean;
}

/** 结算队列里的一步（可以被 prompt 打断，回答后接着跑）。 */
export type Task =
  | { readonly t: "damage"; readonly source: string; readonly hits: readonly Hit[]; readonly attack: boolean }
  | { readonly t: "askYield"; readonly targets: readonly { readonly player: string; readonly damage: number }[] }
  | { readonly t: "enter" }
  | { readonly t: "toBuy" }
  | { readonly t: "endTurn" }
  /** 一批伤害结束后：查出局 / 只剩一只 / 当前玩家死了。 */
  | { readonly t: "afterBatch" };

/** 本回合的状态。 */
export interface TurnState {
  readonly player: string;
  /** 本回合骰子。 */
  dice: Die[];
  /** 还能掷几次（含第一次）：开始是 3（+巨脑）。 */
  rollsLeft: number;
  /** 已经掷过几次。 */
  rolls: number;
  /** 剔除弱者本回合用过。 */
  herdCullerUsed: boolean;
  /** 骰子结算完了没有。 */
  resolved: boolean;
  /** 本回合有没有对别的怪兽造成伤害（草食动物）。 */
  dealtDamage: boolean;
  /** 本回合计分了三个 1（冻结时间）。 */
  scoredOnes: boolean;
  /** 变形卖卡换来的能量，回合结束时到账。 */
  metamorphEnergy: number;
  /** 这是冻结时间连续给的第几个追加回合（每个少一颗骰）。 */
  freezeStack: number;
  /** 本回合让位的怪兽（钻地：接替的人挨 1 伤害）。 */
  vacated: Partial<Record<Spot, string>>;
  /** 本回合这次攻击里每只怪兽实际掉的血（挨了爪才能让位）。 */
  attackDamage: Record<string, number>;
  /** 背景住户本回合免费重掷了几次（上限 10，防止无限重掷）。 */
  dwellerRerolls: number;
}

export type GameCommand =
  /** 第一次掷：掷全部骰子（keep 忽略）；重掷：keep 里的留下，其余重掷。use：重掷次数用完后用烟雾标记 / 心灵感应（1 能量）多掷一次。 */
  | { readonly type: "ROLL"; readonly keep?: readonly number[]; readonly use?: "smoke" | "telepath" }
  /** 改一颗骰子：剔除弱者（改成 1，每回合一次）、剧情反转（任意面，用后弃卡）、弹性（2 能量，任意面）。 */
  | { readonly type: "CHANGE_DIE"; readonly index: number; readonly face: Face; readonly via: "herd-culler" | "plot-twist" | "stretchy" }
  /** 不再重掷，结算骰子。 */
  | { readonly type: "RESOLVE" }
  /** 第一次掷骰前：花 1 能量把模仿标记放到另一张 KEEP 卡上。 */
  | { readonly type: "MIMIC"; readonly target: string }
  | { readonly type: "YIELD"; readonly yield: boolean }
  | { readonly type: "WINGS"; readonly use: boolean }
  /** 买一张卡：公开的 3 张、牌堆顶（实验室出品）、别人的 KEEP 卡（寄生触手）。 */
  | { readonly type: "BUY"; readonly uid: string; readonly mimicTarget?: string; readonly batteryEnergy?: number }
  | { readonly type: "SWEEP" }
  /** 变形：卖掉自己的一张 KEEP 卡，按印刷价换能量（回合结束到账）。 */
  | { readonly type: "SELL"; readonly uid: string }
  | { readonly type: "END_TURN" }
  /** 快速治疗：任何时候花 2 能量回 1 血（不用轮到自己）。 */
  | { readonly type: "RAPID_HEAL" };

export type VpReason =
  | "dice" | "enter" | "startInCity" | "card" | "alpha" | "omnivore" | "gourmet" | "destruction"
  | "news" | "eater" | "hoarder" | "underdog" | "herbivore" | "urbavore";

export type GameEvent =
  | { readonly type: "TurnStarted"; readonly player: string; readonly extra?: "frenzy" | "freeze" }
  | { readonly type: "Rolled"; readonly player: string; readonly dice: (Face | null)[]; readonly rerolled: number[]; readonly use?: "smoke" | "telepath" | "dweller" }
  | { readonly type: "DieChanged"; readonly player: string; readonly index: number; readonly face: Face; readonly via: string }
  | { readonly type: "Resolved"; readonly player: string; readonly dice: Face[] }
  | { readonly type: "Vp"; readonly player: string; readonly amount: number; readonly reason: VpReason; readonly card?: CardId }
  | { readonly type: "Energy"; readonly player: string; readonly amount: number; readonly reason: string }
  | { readonly type: "Healed"; readonly player: string; readonly amount: number; readonly reason: string }
  | { readonly type: "TokenRemoved"; readonly player: string; readonly token: "poison" | "shrink"; readonly count: number }
  | { readonly type: "TokenAdded"; readonly player: string; readonly token: "poison" | "shrink"; readonly by: string }
  | { readonly type: "Attack"; readonly player: string; readonly damage: number; readonly targets: string[] }
  | { readonly type: "Damaged"; readonly player: string; readonly source: string; readonly amount: number; readonly attack: boolean; readonly blocked?: number; readonly blockedBy?: string }
  | { readonly type: "LifeLost"; readonly player: string; readonly amount: number; readonly reason: "poison" | "evenBigger" }
  | { readonly type: "Entered"; readonly player: string; readonly spot: Spot; readonly how?: "drop" | "bayClosed" }
  | { readonly type: "Yielded"; readonly player: string; readonly spot: Spot; readonly to: string }
  | { readonly type: "Stayed"; readonly player: string; readonly spot: Spot }
  | { readonly type: "Left"; readonly player: string; readonly spot: Spot; readonly reason: "bayClosed" | "pushed" | "reborn" }
  | { readonly type: "Eliminated"; readonly player: string; readonly by: string | null }
  | { readonly type: "Reborn"; readonly player: string }
  | { readonly type: "Bought"; readonly player: string; readonly card: CardId; readonly cost: number; readonly from: string }
  | { readonly type: "Swept"; readonly player: string; readonly discarded: CardId[] }
  | { readonly type: "Sold"; readonly player: string; readonly card: CardId; readonly energy: number }
  | { readonly type: "CardDiscarded"; readonly player: string; readonly card: CardId; readonly reason: string }
  | { readonly type: "WingsUsed"; readonly player: string }
  | { readonly type: "MimicSet"; readonly player: string; readonly card: CardId; readonly owner: string }
  | { readonly type: "EnergyLost"; readonly player: string; readonly amount: number; readonly reason: string }
  | { readonly type: "VpLost"; readonly player: string; readonly amount: number; readonly reason: string }
  | { readonly type: "BayClosed" }
  | { readonly type: "TurnTimedOut"; readonly player: string; readonly stage: Stage | "wings" | "yield" }
  | { readonly type: "GameEnded"; readonly winners: string[]; readonly reason: FinalResult["reason"] };

export interface FinalResult {
  /** 获胜者（可以并列，也可以一个都没有：全员同时出局）。 */
  readonly winners: string[];
  readonly reason: "vp" | "lastStanding" | "allDead";
}

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 当前回合的玩家下标。 */
  currentPlayer: number;
  /** 第几个回合（每换一次回合 +1，追加回合也算），从 1 开始。 */
  turn: number;
  /** 本回合第几步；服务端按 turn + step 给每一步计时。只在换人或换步骤时变（快速治疗不变）。 */
  step: number;
  stage: Stage;
  turnState: TurnState;
  prompt?: Prompt;
  /** prompt 打断后要接着跑的结算队列（都是公开信息）。 */
  queue: Task[];
  /** 城心、港湾里的怪兽。 */
  city: string | null;
  bay: string | null;
  /** 港湾在用（5–6 人开局，降到 4 只及以下关闭）。 */
  bayOpen: boolean;
  /** 公开的 3 张（空格 = 牌堆抽空了）。 */
  market: (CardInstance | null)[];
  /** 牌堆（隐藏，下发时清空，只给张数）。 */
  deck: CardInstance[];
  deckCount: number;
  /** 实验室出品：只在下发给正在买牌的主人本人时才有，是牌堆顶那张。 */
  peek?: CardInstance;
  discard: CardInstance[];
  /** 已排队的追加回合（狂暴 / 冻结时间）。 */
  extraTurns: ("frenzy" | "freeze")[];
  /** 本次动作产生的事件。 */
  events: GameEvent[];
  /** 最近的事件（给日志用），带产生时的 version。 */
  recent: { readonly v: number; readonly e: GameEvent }[];
  finalResult?: FinalResult;
  /** 每个动作 +1；前端据此判断是不是新事件。 */
  version: number;
  /** 以下只在服务端：随机数状态、动作序列。 */
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
