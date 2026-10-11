import { useState } from "react";

/** 规则说明：用自己的话写，不照搬原版规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>先到 <b>20 分</b>（要撑过这个回合），或者成为<b>最后一只还站着的怪兽</b>。</p>
          </div>
          <div className="game-rules-block">
            <h3>掷骰</h3>
            <ul>
              <li>每回合掷 6 颗骰子，点骰子把它<b>留下</b>，其余重掷；最多重掷 <b>2 次</b>，留下的也可以拿起来重掷。</li>
              <li><b>1 / 2 / 3</b>：三个一样才得分，三个 n 得 n 分，每多一个 +1（四个 3 = 4 分）。</li>
              <li><b>闪电</b>：一颗 1 能量，攒着买卡。<b>心</b>：一颗回 1 血（上限 10），<b>在城里不能用</b>。</li>
              <li><b>爪</b>：打人。在城外打城里的怪兽，在城里打城外的所有怪兽。</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>城心</h3>
            <ul>
              <li>结算完骰子，城心空着就<b>必须进去</b>（+1 分）；回合开始还在城心 <b>+2 分</b>。</li>
              <li>在城里被爪打中后可以<b>让位</b>：离开城心，打你的怪兽进来（伤害照吃）。卡牌造成的伤害不能让位。</li>
              <li>5–6 人局多一个<b>港湾</b>，也算在城里；城心和港湾的怪兽互不打。只剩 4 只时港湾关闭。</li>
              <li>2 人局进城、坐镇城里给 1 能量，不给分。</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>超能力卡</h3>
            <ul>
              <li>能量买公开的 3 张卡，左上角是价格。<b>保留</b>卡一直生效，<b>一次性</b>卡立刻生效后弃掉。</li>
              <li>花 2 能量可以把 3 张换一批。点卡能看大图和完整说明。</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>其他</h3>
            <ul>
              <li>限时：掷骰 40 秒（超时直接结算）、让位 20 秒（超时留下）、买卡 30 秒（超时结束回合）。连续超时两次由人机托管。</li>
              <li>骰子在服务器上掷。掉线后用原昵称和房间码可以回到自己的座位。</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
