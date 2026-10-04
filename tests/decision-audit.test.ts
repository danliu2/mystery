import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGame, abortGame, fullReview } from "../src/domain/engine.js";
import { observe } from "../src/domain/visibility.js";
import { Store } from "../src/storage/store.js";

test("agent reasoning survives durable restore but only terminal review exposes it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mystery-audit-"));
  try {
    const store = new Store(dir);
    const s = createGame({ count: 6, seed: 31 });
    (s as any).decisionAudits = [
      {
        seat: 2,
        playerId: s.players[1].playerId,
        name: s.players[1].name,
        day: 1,
        phase: "night",
        windowId: s.window.id,
        source: "model",
        action: { type: "wolfVote", targetSeat: 3 },
        model: "fixture",
        decisionReason: "投票给3号，因为其发言矛盾。",
        attempts: [
          {
            reasoningContent: "private-thinking-sentinel",
            content: "private-answer-sentinel",
          },
        ],
      },
    ];
    await store.commit(s);
    const restored = await store.load(s.id);
    assert.ok(restored);
    assert.equal(
      (restored as any).decisionAudits[0].decisionReason,
      "投票给3号，因为其发言矛盾。",
    );
    assert.ok(
      !JSON.stringify(observe(restored!, 1)).includes(
        "private-thinking-sentinel",
      ),
    );
    assert.throws(() => fullReview(restored!), /GAME_NOT_ENDED/);
    const review = fullReview(abortGame(restored!)) as any;
    assert.equal(
      review.decisionAudits[0].attempts[0].reasoningContent,
      "private-thinking-sentinel",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { createServer } from "node:http";
import { once } from "node:events";
import { Session } from "../src/main/session.js";
import { Gateway } from "../src/llm/gateway.js";
import { demoDecision } from "../src/agents/player.js";
import { createRoster } from "../src/agents/personas.js";
import { randomUUID } from "node:crypto";

test("accepted network decisions are persisted with private reasoning through the actual session", async () => {
  const persona = createRoster(3).people[0];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const data = JSON.parse(body.messages[1].content);
    const content = data.observation
      ? JSON.stringify({
          action: demoDecision(data.observation, persona),
          decisionReason: "我相信公开发言提供的信息，以此选择目标。",
        })
      : JSON.stringify({ reflection: "本局应注意公开票型。" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { content, reasoning_content: "network-private-thinking" },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 100 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const dir = await mkdtemp(join(tmpdir(), "mystery-session-audit-"));
  const session = new Session(
    new Store(dir),
    new Gateway({
      baseURL: `http://127.0.0.1:${(server.address() as any).port}`,
      apiKey: "fake-key",
      model: "fixture",
      jsonMode: true,
      contextTokens: 32000,
      maxRequests: 1000,
      maxTokens: 1000000,
    }),
  );
  try {
    await session.initialize();
    await session.start({ count: 6, humanRole: "villager", mode: "model" });
    for (let step = 0; step < 2000; step++) {
      let v = session.view()!;
      if (v.observation.outcome) break;
      if (!v.spectator)
        assert.ok(!JSON.stringify(v).includes("network-private-thinking"));
      else if (v.spectator.decisionAudits.some((a) => a.source === "model"))
        assert.ok(
          JSON.stringify(v.spectator).includes("network-private-thinking"),
        );
      assert.equal(v.paused, false, v.notice);
      if (v.displayed < v.presentationTarget)
        await session.ack(`v${v.presentationTarget}`);
      v = session.view()!;
      if (v.observation.legalActions.length)
        await session.act({
          commandId: randomUUID(),
          windowId: v.observation.windowId!,
          action: demoDecision(v.observation, persona),
        });
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(session.view()!.observation.outcome, "game must finish");
    const review = await session.review();
    assert.ok(review.decisionAudits.length > 0);
    assert.ok(
      review.decisionAudits.every(
        (a) =>
          a.source === "model" &&
          a.attempts[0].reasoningContent === "network-private-thinking" &&
          a.decisionReason,
      ),
    );
    const saved = await session.store.load(session.view()!.observation.gameId);
    assert.deepEqual(saved!.decisionAudits, review.decisionAudits);
  } finally {
    session.pause();
    await session.idle();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
