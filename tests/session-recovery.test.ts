import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Session } from "../src/main/session.js";
import { Store } from "../src/storage/store.js";
import { Gateway } from "../src/llm/gateway.js";
import { defaultAction } from "../src/domain/engine.js";
import { demoDecision } from "../src/agents/player.js";
import type { Observation } from "../src/domain/types.js";
import type { Persona } from "../src/agents/personas.js";
const config = {
  baseURL: "http://127.0.0.1:1",
  apiKey: "fixture",
  model: "fixture",
  jsonMode: true,
  contextTokens: 32000,
  maxRequests: 300,
  maxTokens: 200000,
};
class ReflectingModel extends Gateway {
  async decide(view: Observation, p: Persona) {
    return demoDecision(view, p);
  }
  async reflect(
    _view: Observation,
    _p: Persona,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 500);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { once: true },
      );
    });
  }
}
test("model mode and already spent budget survive restore instead of silently becoming demo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-mode-"));
  const g = new Gateway({ ...config });
  const s = new Session(new Store(dir), g);
  try {
    await s.initialize();
    await s.start({ count: 6, humanRole: "wolf", mode: "model" });
    g.usage = { requests: 22, tokens: 1000, estimated: false };
    let v = s.view()!;
    await s.ack(v.observation.events.at(-1)!.id);
    v = s.view()!;
    await s.act({
      commandId: "v",
      windowId: v.observation.windowId!,
      action: { type: "wolfVote", targetSeat: null },
    });
    s.pause();
    const restoredGateway = new Gateway({ ...config });
    const restored = new Session(new Store(dir), restoredGateway);
    await restored.initialize();
    await restored.load(v.observation.gameId);
    assert.equal(restored.view()!.mode, "model");
    assert.equal(restoredGateway.usage.requests, 22);
    restored.pause();
  } finally {
    s.pause();
    await s.idle();
    await rm(dir, { recursive: true, force: true });
  }
});
test("pause cancels postgame reflection and releases next-game gate promptly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-reflect-"));
  const s = new Session(new Store(dir), new ReflectingModel({ ...config }));
  let actionPromise: Promise<unknown> | null = null;
  try {
    await s.initialize();
    await s.start({ count: 6, humanRole: "villager", mode: "model" });
    for (let i = 0; i < 1000; i++) {
      const v = s.view()!;
      if (v.observation.outcome) break;
      if (v.displayed < v.presentationTarget)
        await s.ack(`v${v.presentationTarget}`);
      else if (v.observation.legalActions.length) {
        const command = {
          commandId: `h${i}`,
          windowId: v.observation.windowId!,
          action: defaultAction(v.observation),
        };
        actionPromise = s.act(command);
        void actionPromise.catch(() => {});
      }
      await sleep(15);
    }
    assert.ok(s.view()!.observation.outcome);
    assert.equal(s.view()!.finishing, true);
    s.pause();
    await sleep(100);
    assert.equal(s.view()!.finishing, false);
  } finally {
    s.pause();
    if (actionPromise) await actionPromise.catch(() => {});
    await s.idle();
    await rm(dir, { recursive: true, force: true });
  }
});

test("live model request counts stay private until the match ends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-usage-"));
  const g = new Gateway({ ...config });
  const s = new Session(new Store(dir), g);
  try {
    await s.initialize();
    await s.start({ count: 6, humanRole: "wolf", mode: "model" });
    const before = s.view();
    g.usage.requests = 13;
    g.usage.tokens = 4321;
    assert.deepEqual(s.view(), before);
  } finally {
    s.pause();
    await s.idle();
    await rm(dir, { recursive: true, force: true });
  }
});

class FailingStore extends Store {
  failNextCommit = false;
  failRoster = false;
  async commit(state: import("../src/domain/types.js").GameState) {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("disk full fixture");
    }
    return super.commit(state);
  }
  async saveRoster(roster: import("../src/agents/personas.js").Roster) {
    if (this.failRoster) throw new Error("disk full fixture");
    return super.saveRoster(roster);
  }
}
test("storage retry retains the accepted candidate instead of requiring a new decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-pending-"));
  const store = new FailingStore(dir);
  const s = new Session(store, null);
  try {
    await s.initialize();
    await s.start({ count: 6, humanRole: "wolf" });
    let v = s.view()!;
    await s.ack(`v${v.presentationTarget}`);
    v = s.view()!;
    store.failNextCommit = true;
    await assert.rejects(
      s.act({
        commandId: "pending",
        windowId: v.observation.windowId!,
        action: { type: "wolfVote", targetSeat: 3 },
      }),
      /STORAGE_FAILED/,
    );
    assert.equal(s.view()!.paused, true);
    await s.resume();
    assert.equal(s.view()!.observation.submitted, true);
    assert.deepEqual(
      (await store.load(v.observation.gameId))?.window.answers[1],
      { type: "wolfVote", targetSeat: 3 },
    );
  } finally {
    s.pause();
    await s.idle();
    await rm(dir, { recursive: true, force: true });
  }
});
test("old saves require explicit consent to restore their original friend pool", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-roster-save-"));
  const original = new Session(new Store(dir), null);
  const restored = new Session(new Store(dir), null);
  try {
    await original.initialize();
    await original.start({ count: 6, humanRole: "wolf" });
    const id = original.view()!.observation.gameId;
    const names = original.lobby().people.map((p) => p.id);
    original.pause();
    await restored.initialize();
    await restored.initializeFriends(false);
    await assert.rejects(restored.load(id), /ROSTER_MISMATCH/);
    assert.equal(restored.view(), null);
    await restored.load(id, true);
    assert.deepEqual(
      restored.lobby().people.map((p) => p.id),
      names,
    );
  } finally {
    original.pause();
    restored.pause();
    await original.idle();
    await restored.idle();
    await rm(dir, { recursive: true, force: true });
  }
});

test("roster persistence failure releases finishing and restart supplements experience exactly once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-roster-error-"));
  const store = new FailingStore(dir);
  const s = new Session(store, new ReflectingModel({ ...config }));
  let actionPromise: Promise<unknown> | null = null;
  try {
    await s.initialize();
    await s.start({ count: 6, humanRole: "villager", mode: "model" });
    store.failRoster = true;
    for (let i = 0; i < 1000; i++) {
      const v = s.view()!;
      if (v.observation.outcome) break;
      if (v.displayed < v.presentationTarget)
        await s.ack(`v${v.presentationTarget}`);
      else if (v.observation.legalActions.length) {
        actionPromise = s.act({
          commandId: `error${i}`,
          windowId: v.observation.windowId!,
          action: defaultAction(v.observation),
        });
        void actionPromise.catch(() => {});
      }
      await sleep(15);
    }
    assert.ok(s.view()!.observation.outcome);
    await s.idle();
    assert.equal(s.view()!.finishing, false);
    assert.ok(s.view()!.notice.includes("经验写入失败"));
    const id = s.view()!.observation.gameId;
    const restored = new Session(new Store(dir), null);
    await restored.initialize();
    await restored.load(id);
    assert.equal(
      restored.lobby().people.filter((p) => p.games === 1).length,
      5,
    );
    await restored.load(id);
    assert.equal(
      restored.lobby().people.filter((p) => p.games === 1).length,
      5,
    );
    restored.pause();
  } finally {
    s.pause();
    if (actionPromise) await actionPromise.catch(() => {});
    await s.idle();
    await rm(dir, { recursive: true, force: true });
  }
});
