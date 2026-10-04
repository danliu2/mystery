import test from "node:test";
import assert from "node:assert/strict";
import { createGame, submit } from "../src/domain/engine.js";
import { observe } from "../src/domain/visibility.js";
import { createRoster, selectFriends } from "../src/agents/personas.js";
import { demoDecision } from "../src/agents/player.js";
test("all supported boards complete with projected decisions and replay identically", () => {
  for (let count = 6; count <= 14; count++) {
    const roster = createRoster(57);
    const friends = selectFriends(roster, count - 1, 57);
    const setup = {
      gameId: "game-00000000-0000-4000-8000-000000000057",
      count,
      seed: 57,
      friends: friends.map((p) => ({
        playerId: p.id,
        name: p.name,
        description: p.description,
      })),
    };
    let s = createGame(setup);
    const commands: { seat: number; command: any }[] = [];
    let steps = 0;
    while (!s.outcome) {
      assert.ok(++steps < 2000);
      const seat = s.window.actors.find(
        (i) => !Object.hasOwn(s.window.answers, i),
      )!;
      assert.ok(seat);
      const view = observe(s, seat);
      const p = seat === 1 ? roster.people[19] : friends[seat - 2];
      const command = {
        commandId: `c${steps}`,
        windowId: view.windowId!,
        action: demoDecision(view, p),
      };
      commands.push({ seat, command });
      s = submit(s, seat, command);
    }
    let replay = createGame(setup);
    for (const entry of commands)
      replay = submit(replay, entry.seat, entry.command);
    assert.deepEqual(replay, s);
    assert.ok(["good_win", "wolf_win", "draw"].includes(s.outcome.status));
  }
});
