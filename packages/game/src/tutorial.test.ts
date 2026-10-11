import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { actorId, apply, legalActions, playerById, redactGameForViewer } from "./engine.js";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  createTutorialRng,
  sameCommand,
  TUTORIAL_DICE,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  type TutorialRng,
} from "./tutorial.js";
import type { GameState } from "./types.js";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length, rng: TutorialRng = createTutorialRng(1)): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
    if (step.kind === "watch") for (const move of step.moves) game = apply(game, actorId(game), move, rng).state;
  }
  return game;
}

const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);
const me = (game: GameState) => playerById(game, TUTORIAL_SELF);

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见，剧本骰子正好用完", () => {
    let game = createTutorialGame("小蒲");
    const rng = createTutorialRng(1);
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(actorId(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」这一步不合法`).toBe(true);
        game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = actorId(game);
          expect(actor, `「${step.id}」里轮到了你`).not.toBe(TUTORIAL_SELF);
          expect(legalActions(game, actor).some((command) => sameCommand(command, move)), `「${step.id}」里 ${actor} 的 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = apply(game, actor, move, rng).state;
        }
      }
    }
    expect(rng.remaining).toBe(0);
    expect(game.phase).toBe("playing");
  });

  it("关键的几幕一定发生：凑出三个 3 进城心、咕噜一号打你 2 下弹出让位、回合开始 +2、买摩天楼 +4", () => {
    const afterKeep = playScript(stepIndex("keep") + 1);
    expect(afterKeep.turnState.dice.map((die) => die.face)).toEqual(["3", "3", "3", "energy", "energy", "claw"]);

    const afterResolve = playScript(stepIndex("resolve") + 1);
    expect(afterResolve.city).toBe(TUTORIAL_SELF);
    expect(me(afterResolve)).toMatchObject({ vp: 4, energy: 2, life: 10 });
    expect(afterResolve.stage).toBe("buy");

    const afterRival = playScript(stepIndex("rival") + 1);
    expect(afterRival.prompt).toMatchObject({ kind: "yield", player: TUTORIAL_SELF, attacker: "p2", damage: 2 });
    expect(me(afterRival).life).toBe(8);

    const afterOthers = playScript(stepIndex("others") + 1);
    expect(afterOthers.players[afterOthers.currentPlayer]!.id).toBe(TUTORIAL_SELF);
    expect(afterOthers.city).toBe(TUTORIAL_SELF);
    expect(me(afterOthers).vp).toBe(6);
    expect(afterOthers.stage).toBe("roll");

    const afterResolve2 = playScript(stepIndex("resolve2") + 1);
    expect(me(afterResolve2)).toMatchObject({ energy: 6, life: 8 });
    expect(["p2", "p3", "p4"].map((id) => playerById(afterResolve2, id).life)).toEqual([9, 9, 9]);

    const afterBuy = playScript(stepIndex("buy") + 1);
    expect(me(afterBuy)).toMatchObject({ vp: 10, energy: 0 });

    const end = playScript();
    expect(end.players[end.currentPlayer]!.id).toBe("p2");
  });

  it("剧本自身：id 不重复，finale 唯一且在最后，每步都有一句话，主句不长", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.length).toBeGreaterThan(0);
      expect(step.say.length, step.id).toBeLessThanOrEqual(26);
    }
  });

  it("剧本骰子先按剧本出，用完以后是普通随机数", () => {
    const rng = createTutorialRng(5, ["claw", "1"]);
    expect(rng.int(6)).toBe(5);
    expect(rng.int(6)).toBe(0);
    expect(rng.remaining).toBe(0);
    const value = rng.int(6);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(6);
    expect(TUTORIAL_DICE.length).toBe(34);
  });

  it("剧本走完接练习局：交给人机打，都能打完；再练一局也能打完", () => {
    const stuck: string[] = [];
    for (let game = 0; game < 120; game += 1) {
      const rng = createTutorialRng(1000 + game, []);
      let state = game === 0 ? playScript() : createPracticeGame("小蒲", 1000 + game);
      let steps = 0;
      while (state.phase === "playing" && steps < 3000) {
        const actor = actorId(state);
        const command = botCommand(redactGameForViewer(state, actor), actor);
        if (!command) break;
        state = apply(state, actor, command, rng).state;
        steps += 1;
      }
      if (state.phase !== "finished") stuck.push(`第 ${game} 局`);
    }
    expect(stuck).toEqual([]);
  });
});
