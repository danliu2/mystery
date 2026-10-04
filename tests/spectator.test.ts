import test from "node:test";
import assert from "node:assert/strict";
import { createGame, fullReview } from "../src/domain/engine.js";
import {
  observe,
  observeHuman,
  isSpectating,
} from "../src/domain/visibility.js";

test("human elimination reveals every role and private event without changing AI observations", () => {
  const s = createGame({ count: 6, seed: 31 });
  assert.equal(isSpectating(s, 1), false);
  assert.throws(() => fullReview(s, 1), /GAME_NOT_ENDED/);
  s.players[0].alive = false;
  s.death.words = [];
  s.window.actors = [2];
  s.events.push({
    day: 1,
    type: "audit",
    text: "private sentinel",
    audience: "host",
  } as any);
  const human = observeHuman(s, 1);
  assert.equal(isSpectating(s, 1), true);
  assert.ok(fullReview(s, 1).events.some((e) => e.text === "private sentinel"));
  assert.throws(() => fullReview(s, 2), /GAME_NOT_ENDED/);
  assert.equal(human.events.length, s.events.length);
  assert.deepEqual(
    human.players.map((p) => p.revealedRole),
    s.players.map((p) => p.role),
  );
  assert.equal(human.phase, s.phase);
  assert.deepEqual(human.legalActions, []);
  assert.ok(observe(s, 2).events.length < human.events.length);
  assert.ok(observe(s, 2).players.some((p) => p.revealedRole === null));
});

test("death skills, queued last words and badge disposal retain limited vision", () => {
  const s = createGame({ count: 6, seed: 31 });
  s.players[0].alive = false;
  s.window.actors = [2];
  s.phase = "hunterShoot";
  s.death.words = [1];
  assert.equal(isSpectating(s, 1), false);
  s.death.words = [];
  s.death.hunters = [1];
  assert.equal(isSpectating(s, 1), false);
  s.death.hunters = [];
  s.sheriff = 1;
  assert.equal(isSpectating(s, 1), false);
  s.sheriff = null;
  s.window.actors = [1];
  assert.equal(isSpectating(s, 1), false);
  s.outcome = { status: "wolf_win", reason: "fixture" };
  assert.equal(isSpectating(s, 1), true);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { Session } from "../src/main/session.js";
test("restored eliminated human automatically receives live spectator review and can acknowledge private events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-spectator-"));
  try {
    const store = new Store(dir);
    const s = createGame({ count: 6, seed: 31 });
    s.players.forEach((p) => {
      p.playerId = null;
    });
    s.players[0].alive = false;
    s.window.actors = [2];
    s.death.words = [];
    s.events.push({
      day: 1,
      type: "audit",
      text: "hidden action",
      audience: "host",
      data: { targetSeat: 3 },
    } as any);
    s.decisionAudits = [
      {
        seat: 2,
        name: "fixture",
        action: { type: "wolfVote", targetSeat: 3 },
        decisionReason: "reason sentinel",
        attempts: [{ reasoningContent: "think sentinel" }],
      } as any,
    ];
    await store.commit(s);
    const session = new Session(store, null);
    await session.initialize();
    const view = await session.load(s.id);
    assert.equal(
      view!.spectator!.decisionAudits[0].decisionReason,
      "reason sentinel",
    );
    assert.equal(
      view!.spectator!.decisionAudits[0].attempts[0].reasoningContent,
      "think sentinel",
    );
    assert.equal(view!.observation.events.length, s.events.length);
    assert.ok(view!.observation.players.every((p) => p.revealedRole));
    await session.ack(`v${s.events.length}`);
    assert.equal(session.view()!.displayed, s.events.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
