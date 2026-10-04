import test from "node:test";
import assert from "node:assert/strict";
import { validateIPC } from "../src/main/ipc.js";
import { createGame } from "../src/domain/engine.js";
import { observe } from "../src/domain/visibility.js";
test("IPC rejects injected principal and malformed action payloads before dispatch", () => {
  assert.throws(
    () =>
      validateIPC("act", {
        commandId: "x",
        windowId: "w",
        actorSeat: 2,
        action: { type: "wolfVote", targetSeat: 3 },
      }),
    /INVALID_IPC/,
  );
  assert.throws(() => validateIPC("start", { count: 99 }), /INVALID_IPC/);
  assert.throws(() => validateIPC("load", "../secret"), /INVALID_IPC/);
  assert.throws(() => validateIPC("shell", { cmd: "x" }), /INVALID_IPC/);
});
test("dead human receives only own identity and public roster proofs", () => {
  const s = createGame({ count: 6, seed: 123, humanRole: "villager" });
  s.players[0].alive = false;
  const v = observe(s, 1);
  assert.equal(v.ownRole, "villager");
  assert.equal(v.players[0].alive, false);
  assert.ok(v.players.slice(1).every((p) => p.revealedRole === null));
  assert.ok(!JSON.stringify(v).includes("rng"));
});
