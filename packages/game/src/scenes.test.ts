import { describe, expect, it } from "vitest";
import { DECK_SIZE } from "./cards.js";
import { SCENE_NAMES, scene } from "./scenes.js";

describe("预览局面工厂", () => {
  for (const name of SCENE_NAMES) {
    it(`scene("${name}") 造得出来，卡牌守恒`, () => {
      const state = scene(name);
      const total = state.deck.length + state.market.filter(Boolean).length + state.discard.length
        + state.players.reduce((n, player) => n + player.cards.length, 0);
      expect(total).toBe(DECK_SIZE);
    });
  }
  it("几个关键局面的形状", () => {
    expect(scene("yield").prompt?.kind).toBe("yield");
    expect(scene("wings").prompt?.kind).toBe("wings");
    expect(scene("yieldJets").prompt).toMatchObject({ kind: "yield", jetsBefore: true });
    expect(scene("endTie").finalResult?.winners).toHaveLength(2);
    expect(scene("endLast").finalResult?.reason).toBe("lastStanding");
    expect(scene("endAllDead").finalResult?.reason).toBe("allDead");
    expect(scene("endVp").finalResult?.reason).toBe("vp");
    expect(scene("start6").bayOpen).toBe(true);
    expect(scene("cityFull6").bay).toBe("p2");
    expect(scene("timeout").events[0]?.type).toBe("TurnTimedOut");
    expect(scene("zeroDice").stage).toBe("buy");
    expect(scene("zeroDice").turnState.dice).toHaveLength(0);
  });
});
