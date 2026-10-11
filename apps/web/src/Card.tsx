// 超能力卡：卡底用 cards/full/<id>.png（卡框 + 插图，没有字），费用、卡名、效果文字由这里叠上去。
// 原图 96×136：费用徽章中心 (14,14)；名字条 (5,69,86,15)；效果区 (5,86,86,44)。只按整数倍缩放。
import type { CSSProperties, ReactNode } from "react";
import { CARDS, type CardId } from "@kaiju/game";
import { cardArt, tokenArt } from "./art.js";

/** 卡面字号：费用、卡名；效果文字放得下就用 24px，放不下用 12px（点开看大卡）。 */
export function cardFonts(scale: number, text = "") {
  const fits = (size: number) => Math.floor((84 * scale) / size) * Math.floor((44 * scale - 2) / (size * 1.15)) >= text.length;
  return {
    cost: scale >= 3 ? 36 : 24,
    name: scale >= 2 ? 24 : 12,
    text: scale >= 2 && fits(24) ? 24 : 12,
  };
}

export function CardFace({
  id,
  scale,
  price,
  onClick,
  dim = false,
  selected = false,
  badge,
  className = "",
  tutorial,
}: {
  id: CardId;
  scale: number;
  /** 显示的价格（打折后）；不传就是印刷价。 */
  price?: number;
  onClick?: () => void;
  dim?: boolean;
  selected?: boolean;
  /** 叠在卡右上角的小标记（模仿、烟雾剩几个、电池剩几个）。 */
  badge?: ReactNode;
  className?: string;
  tutorial?: string;
}) {
  const def = CARDS[id];
  const fonts = cardFonts(scale, def.text);
  const style = {
    "--s": scale,
    width: 96 * scale,
    height: 136 * scale,
    "--cost-font": `${fonts.cost}px`,
    "--name-font": `${fonts.name}px`,
    "--text-font": `${fonts.text}px`,
  } as CSSProperties;
  const cost = price ?? def.cost;
  const content = (
    <>
      <img className="kj-card-img" src={cardArt.full(id)} alt="" draggable={false} />
      <b className={cost < def.cost ? "kj-card-cost cheaper" : "kj-card-cost"}>{cost}</b>
      <span className="kj-card-name">{def.name}</span>
      <span className="kj-card-text">{def.text}</span>
      {scale >= 2 && <span className={`kj-card-kind ${def.kind}`}>{def.kind === "keep" ? "保留" : "一次性"}</span>}
      {badge && <span className="kj-card-badge">{badge}</span>}
    </>
  );
  const classes = ["kj-card", def.kind, dim ? "dim" : "", selected ? "selected" : "", onClick ? "clickable" : "", className].filter(Boolean).join(" ");
  return onClick ? (
    <button type="button" className={classes} style={style} onClick={onClick} aria-label={`${def.name}，${cost} 能量：${def.text}`} data-tutorial={tutorial}>
      {content}
    </button>
  ) : (
    <div className={classes} style={style} aria-label={`${def.name}：${def.text}`} data-tutorial={tutorial}>{content}</div>
  );
}

/** 玩家面板里的保留卡缩略图（42×30，1×），点开看大卡。 */
export function CardChip({ id, onClick, mimic, extra }: { id: CardId; onClick?: () => void; mimic?: boolean; extra?: string }) {
  const def = CARDS[id];
  return (
    <button type="button" className={mimic ? "kj-chip mimicked" : "kj-chip"} onClick={onClick} title={`${def.name}：${def.text}`} aria-label={def.name}>
      <img src={cardArt.thumb(id)} alt="" draggable={false} />
      {extra && <span className="kj-chip-extra">{extra}</span>}
      {mimic && <img className="kj-chip-mimic" src={tokenArt.mimic} alt="被模仿" />}
    </button>
  );
}
