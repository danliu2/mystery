import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../src/main/session.js";
import { Store } from "../src/storage/store.js";
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "mystery-session-"));
  const session = new Session(new Store(dir), null);
  await session.initialize();
  return {
    session,
    dir,
    close: async () => {
      session.pause();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("session binds actions to the human and gates full review until ended", async () => {
  const f = await setup();
  try {
    await f.session.start({ count: 6, humanRole: "wolf" });
    const v = f.session.view();
    assert.equal(v?.observation.ownSeat, 1);
    await assert.rejects(f.session.review(), /GAME_NOT_ENDED/);
    assert.ok(!JSON.stringify(v).includes("rng"));
    const w = v!.observation.windowId!;
    await f.session.ack(v!.observation.events.at(-1)!.id);
    await assert.rejects(
      f.session.act({
        commandId: "attack",
        windowId: w,
        action: { type: "seerCheck", targetSeat: 2 },
      }),
      /INVALID_PAYLOAD/,
    );
  } finally {
    await f.close();
  }
});
test("presentation barrier hides legal actions until visible events acknowledged", async () => {
  const f = await setup();
  try {
    await f.session.start({ count: 6, humanRole: "wolf" });
    assert.equal(f.session.view()!.observation.legalActions.length, 0);
    await f.session.ack(f.session.view()!.observation.events.at(-1)!.id);
    assert.equal(
      f.session.view()!.observation.legalActions[0].type,
      "wolfVote",
    );
  } finally {
    await f.close();
  }
});
test("pause cancels scheduling and restore retains the accepted human vote", async () => {
  const f = await setup();
  try {
    await f.session.start({ count: 6, humanRole: "wolf" });
    let v = f.session.view()!;
    await f.session.ack(v.observation.events.at(-1)!.id);
    v = f.session.view()!;
    await f.session.act({
      commandId: "vote",
      windowId: v.observation.windowId!,
      action: { type: "wolfVote", targetSeat: 3 },
    });
    f.session.pause();
    const restored = new Session(new Store(f.dir), null);
    await restored.initialize();
    await restored.load(v.observation.gameId);
    const saved = await restored.store.load(v.observation.gameId);
    assert.equal(saved!.commands.vote.seat, 1);
    assert.deepEqual(JSON.parse(saved!.commands.vote.fingerprint).action, {
      type: "wolfVote",
      targetSeat: 3,
    });
    const version = saved!.version;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      (await f.session.store.load(v.observation.gameId))!.version,
      version,
    );
    assert.equal(restored.view()!.paused, true);
    restored.pause();
  } finally {
    await f.close();
  }
});
test("abandon ends game without adding experience and repeated exit is safe", async () => {
  const f = await setup();
  try {
    await f.session.start({ count: 6, humanRole: "wolf" });
    await f.session.abandon();
    assert.equal(f.session.view()!.observation.outcome?.status, "aborted");
    assert.ok((await f.session.review()).roles.length === 6);
    assert.equal(f.session.lobby().people[0].games, 0);
  } finally {
    await f.close();
  }
});

import { createRoster } from "../src/agents/personas.js";
import { createGame } from "../src/domain/engine.js";
test("old match identities recover public gender from the preserved friend pool", async () => {
  const f = await setup();
  try {
    const roster = createRoster(41);
    await f.session.store.saveRoster(roster);
    const names = ["苏晚晴", "林知远", "顾清禾", "陆景行", "宋念慈"];
    const s = createGame({
      count: 6,
      seed: 44,
      friends: names.map((name) => {
        const p = roster.people.find((p) => p.name === name)!;
        return { playerId: p.id, name: p.name, description: p.description };
      }),
    });
    await f.session.store.commit(s);
    await f.session.initialize();
    await f.session.load(s.id);
    assert.equal(f.session.view()!.observation.players[1].gender, "女");
    assert.equal(f.session.view()!.observation.players[2].gender, "男");
    await f.session.abandon();
    assert.equal((await f.session.review()).roles[1].gender, "女");
  } finally {
    await f.close();
  }
});
