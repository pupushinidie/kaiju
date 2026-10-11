/**
 * 牌桌中间区域的摆法：按实测的宽高，搜几种摆法和整数倍缩放，挑最大又放得下的。
 * - 城市板 160×128、骰子 44×44、卡 96×136（原图像素），都只按整数倍缩放。
 * - side：城市板在左，右边是提示条、骰子格子和按钮；stack：提示条、城市板、骰子各一行。
 * 下面一行是 3 张公开卡（加牌堆的窄条）。
 */
export interface Scales {
  readonly board: number;
  readonly dice: number;
  readonly card: number;
  readonly arrangement: "side" | "stack";
  /** side 时骰子格子几列。 */
  readonly diceCols: number;
}

export const PROMPT_H = 48;
export const ACTIONS_H = 52;
export const GAP = 10;
const DIE_PAD = 8;
const BUY_ROW_H = 40;
const DECK_W = 72;

export function pickScales(width: number, height: number, boards: number, diceCount: number): Scales {
  const dice = Math.max(diceCount, 6);
  const found: { scales: Scales; score: number }[] = [];
  for (const card of [3, 2, 1]) {
    for (const board of [3, 2, 1]) {
      for (const die of [2, 1]) {
        const marketW = 3 * card * 96 + 2 * GAP + GAP + DECK_W;
        const marketH = card * 136 + BUY_ROW_H;
        const cell = die * 44 + DIE_PAD;
        const boardsW = boards * board * 160 + (boards - 1) * GAP;
        // 城市板画布 128 高，上面再留 52 给站着的怪兽露头
        const boardsH = board * 180;
        // side：城市板在左；右边是提示条、骰子格子和按钮
        for (const cols of [4, 3]) {
          const rows = Math.ceil(dice / cols);
          const rightW = Math.max(cols * cell, 300);
          const rowH = Math.max(boardsH, PROMPT_H + GAP + rows * cell + 8 + ACTIONS_H);
          const w = Math.max(boardsW + GAP + rightW, marketW);
          const h = rowH + GAP + marketH;
          if (w <= width && h <= height) consider({ board, dice: die, card, arrangement: "side", diceCols: cols });
        }
        // stack：骰子一行
        const rowW = dice * cell;
        const w = Math.max(boardsW, rowW, marketW);
        const h = PROMPT_H + boardsH + cell + 8 + ACTIONS_H + marketH + 4 * GAP;
        if (w <= width && h <= height) consider({ board, dice: die, card, arrangement: "stack", diceCols: dice });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.scales ?? { board: 1, dice: 1, card: 1, arrangement: "stack", diceCols: dice };

  function consider(scales: Scales) {
    // 卡最要紧（字要看得清），其次城市板，再其次骰子
    found.push({ scales, score: scales.card * 100 + scales.board * 10 + scales.dice + (scales.arrangement === "side" ? 0.5 : 0) });
  }
}
