import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Gateway } from "../src/llm/gateway.js";
import { parseConfig } from "../src/llm/config.js";
import { createGame } from "../src/domain/engine.js";
import { observe } from "../src/domain/visibility.js";
import { createRoster } from "../src/agents/personas.js";
async function server(
  reply: (
    body: any,
    headers: any,
    n: number,
  ) => { status?: number; body?: any; location?: string },
) {
  let calls = 0;
  const requests: any[] = [];
  const s = createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const body = JSON.parse(text);
    requests.push({ body, headers: req.headers });
    const out = reply(body, req.headers, ++calls);
    res.writeHead(out.status || 200, {
      "content-type": "application/json",
      ...(out.location ? { location: out.location } : {}),
    });
    res.end(
      JSON.stringify(
        out.body ?? {
          choices: [
            {
              message: {
                content:
                  '{"action":{"type":"wolfVote","targetSeat":null},"decisionReason":"选择空刀观察局势。"}',
              },
            },
          ],
        },
      ),
    );
  });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const url = `http://127.0.0.1:${(s.address() as any).port}`;
  return {
    url,
    requests,
    close: () => new Promise<void>((resolve) => s.close(() => resolve())),
  };
}
function view() {
  const s = createGame({ count: 6, seed: 42, humanRole: "wolf" });
  return observe(s, 1);
}
const cfg = (baseURL: string) => ({
  baseURL,
  apiKey: "fake-key-sentinel",
  model: "fixture",
  jsonMode: true,
  contextTokens: 32000,
  maxRequests: 300,
  maxTokens: 200000,
});
test("configuration parsing never executes env text and rejects remote insecure URLs", () => {
  const c = parseConfig(
    'LLM_BASE_URL=http://localhost:11434/v1\nLLM_MODEL="local"\nLLM_API_KEY=$(never-execute)',
  );
  assert.equal(c.apiKey, "$(never-execute)");
  assert.throws(
    () =>
      parseConfig(
        "LLM_BASE_URL=http://example.com\nLLM_MODEL=x\nLLM_API_KEY=k",
      ),
    /INSECURE_ENDPOINT/,
  );
});
test("model prompt is projected and key only appears in Authorization", async () => {
  const fixture = await server(() => ({}));
  try {
    const g = new Gateway(cfg(fixture.url), { sleep: async () => {} });
    const action = await g.decide(view(), createRoster(3).people[0]);
    assert.deepEqual(action, { type: "wolfVote", targetSeat: null });
    const request = fixture.requests[0];
    assert.equal(request.headers.authorization, "Bearer fake-key-sentinel");
    assert.ok(!JSON.stringify(request.body).includes("fake-key-sentinel"));
    assert.ok(!JSON.stringify(request.body).includes("deathReasons"));
    assert.equal(request.body.model, "fixture");
  } finally {
    await fixture.close();
  }
});
test("empty and illegal output repaired once with legal view and then rejected", async () => {
  const fixture = await server((_b, _h, n) => ({
    body: {
      choices: [
        {
          message: {
            content:
              n === 1 ? "" : '{"action":{"type":"wolfVote","targetSeat":99}}',
          },
        },
      ],
    },
  }));
  try {
    const g = new Gateway(cfg(fixture.url));
    await assert.rejects(
      g.decide(view(), createRoster(3).people[0]),
      /INVALID_MODEL_OUTPUT/,
    );
    assert.equal(fixture.requests.length, 2);
  } finally {
    await fixture.close();
  }
});
test("authentication failure is fatal and never blindly retried", async () => {
  const fixture = await server(() => ({
    status: 401,
    body: { error: "secret server detail" },
  }));
  try {
    const g = new Gateway(cfg(fixture.url));
    await assert.rejects(
      g.decide(view(), createRoster(3).people[0]),
      /AUTH_FAILED/,
    );
    assert.equal(fixture.requests.length, 1);
  } finally {
    await fixture.close();
  }
});
test("transient errors retry boundedly and cross-origin redirect is blocked", async () => {
  const fixture = await server((_b, _h, n) => (n < 3 ? { status: 503 } : {}));
  try {
    const g = new Gateway(cfg(fixture.url), { sleep: async () => {} });
    await g.decide(view(), createRoster(3).people[0]);
    assert.equal(fixture.requests.length, 3);
  } finally {
    await fixture.close();
  }
  const redirect = await server(() => ({
    status: 302,
    location: "https://example.com",
  }));
  try {
    await assert.rejects(
      new Gateway(cfg(redirect.url)).decide(view(), createRoster(3).people[0]),
      /REDIRECT_BLOCKED/,
    );
  } finally {
    await redirect.close();
  }
});
test("aborted decisions and exhausted request budgets have no returned action", async () => {
  const fixture = await server(() => ({}));
  try {
    const g = new Gateway({ ...cfg(fixture.url), maxRequests: 1 });
    await g.decide(view(), createRoster(3).people[0]);
    await assert.rejects(
      g.decide(view(), createRoster(3).people[0]),
      /BUDGET_EXCEEDED/,
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(
      new Gateway(cfg(fixture.url)).decide(
        view(),
        createRoster(3).people[0],
        ctrl.signal,
      ),
    );
    assert.equal(fixture.requests.length, 1);
  } finally {
    await fixture.close();
  }
});

test("private audit retains provider thinking and the vote explanation without changing the action", async () => {
  const fixture = await server(() => ({
    body: {
      id: "response-fixture",
      choices: [
        {
          message: {
            reasoning_content: "private-thinking-sentinel",
            content: JSON.stringify({
              action: { type: "wolfVote", targetSeat: null },
              decisionReason: "选择空刀，因为目前没有足够信息。",
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: { total_tokens: 52 },
    },
  }));
  try {
    const g = new Gateway(cfg(fixture.url));
    let audit: any;
    const action = await g.decide(
      view(),
      createRoster(3).people[0],
      undefined,
      (record: any) => {
        audit = record;
      },
    );
    assert.deepEqual(action, { type: "wolfVote", targetSeat: null });
    assert.equal(
      audit.attempts[0].reasoningContent,
      "private-thinking-sentinel",
    );
    assert.equal(audit.decisionReason, "选择空刀，因为目前没有足够信息。");
    assert.ok(!JSON.stringify(action).includes("private-thinking"));
    assert.ok(
      !JSON.stringify(fixture.requests[0].body).includes("fake-key-sentinel"),
    );
  } finally {
    await fixture.close();
  }
});

test("repair preserves both thinking responses and rejects an action missing its private explanation", async () => {
  const fixture = await server((_body, _headers, n) => ({
    body: {
      choices: [
        {
          message: {
            reasoning_content: `thinking-attempt-${n}`,
            content: JSON.stringify({
              action: { type: "wolfVote", targetSeat: null },
              ...(n === 2
                ? { decisionReason: "信息有限，所以保留夜间行动。" }
                : {}),
            }),
          },
          finish_reason: "stop",
        },
      ],
    },
  }));
  try {
    let audit: any;
    const action = await new Gateway(cfg(fixture.url)).decide(
      view(),
      createRoster(3).people[0],
      undefined,
      (r) => {
        audit = r;
      },
    );
    assert.equal(action.type, "wolfVote");
    assert.equal(fixture.requests.length, 2);
    assert.deepEqual(
      audit.attempts.map((r: any) => r.reasoningContent),
      ["thinking-attempt-1", "thinking-attempt-2"],
    );
    assert.equal(audit.decisionReason, "信息有限，所以保留夜间行动。");
    assert.notEqual(audit.attempts[0].promptHash, audit.attempts[1].promptHash);
  } finally {
    await fixture.close();
  }
});

test("thinking output allowance fits the remaining configured context", async () => {
  const fixture = await server(() => ({}));
  try {
    const person = createRoster(3).people[0];
    person.style = "a".repeat(2700);
    const o = view();
    o.players = [];
    o.events = [];
    await new Gateway({
      ...cfg(fixture.url),
      contextTokens: 8192,
      thinking: true,
    }).decide(o, person);
    const body = fixture.requests[0].body;
    const input = body.messages.reduce(
      (n: number, m: any) => n + [...m.content].length,
      0,
    );
    assert.ok(
      input + body.max_tokens + 256 <= 8192,
      `input ${input} + output ${body.max_tokens} exceeds context`,
    );
  } finally {
    await fixture.close();
  }
});

test("non-executable envelope metadata cannot override the validated action", async () => {
  const fixture = await server(() => ({
    body: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              actor: 99,
              submitted: true,
              privateReasoningUnused: "unused",
              action: { type: "wolfVote", targetSeat: null },
              decisionReason: "暂时没有合适的目标，因此空刀。",
            }),
          },
        },
      ],
    },
  }));
  try {
    assert.deepEqual(
      await new Gateway(cfg(fixture.url)).decide(
        view(),
        createRoster(3).people[0],
      ),
      { type: "wolfVote", targetSeat: null },
    );
  } finally {
    await fixture.close();
  }
});
test("explicit provider thinking effort is validated and sent as configuration only", async () => {
  const fixture = await server(() => ({}));
  try {
    const config = parseConfig(
      `LLM_BASE_URL=${fixture.url}\nLLM_MODEL=fixture\nLLM_THINKING=true\nLLM_REASONING_EFFORT=low`,
    );
    await new Gateway(config).decide(view(), createRoster(3).people[0]);
    assert.equal(fixture.requests[0].body.reasoning_effort, "low");
    assert.throws(
      () =>
        parseConfig(
          `LLM_BASE_URL=${fixture.url}\nLLM_MODEL=fixture\nLLM_REASONING_EFFORT=unsupported`,
        ),
      /INVALID_REASONING_EFFORT/,
    );
  } finally {
    await fixture.close();
  }
});
