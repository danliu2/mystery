import { createHash } from "node:crypto";
import { Prompts } from "./prompts.js";
import type { DecisionAttempt, Action, Observation } from "../domain/types.js";
import { GESTURES } from "../domain/types.js";
import { roleName } from "../domain/resources.js";
import type { Persona } from "../agents/personas.js";
import type { ProviderConfig } from "./config.js";
import { validateEndpoint } from "./config.js";
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly fatal = false,
  ) {
    super(code);
  }
}
const fatalStatus: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "AUTH_FAILED",
  402: "NO_BALANCE",
  422: "BAD_PARAMETERS",
};
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ServiceError("CANCELLED"));
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new ServiceError("CANCELLED"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
function actionFields(type: string) {
  return type === "speak"
    ? ["type", "text", "gestureId"]
    : type === "witchUse"
      ? ["type", "mode", "targetSeat"]
      : ["sheriffJoin", "sheriffWithdraw"].includes(type)
        ? ["type", "value"]
        : type === "chooseDirection"
          ? ["type", "direction"]
          : type === "selfDestruct"
            ? ["type"]
            : ["type", "targetSeat"];
}
function candidate(text: string, view: Observation): Action {
  let o: any;
  try {
    o = JSON.parse(text);
  } catch {
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  }
  if (
    !o ||
    !o.action ||
    (o.windowId !== undefined && o.windowId !== view.windowId)
  )
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  const a = o.action as Action;
  const r = view.legalActions.find((r) => r.type === a.type);
  if (!r) throw new ServiceError("INVALID_MODEL_OUTPUT");
  const allowed = actionFields(a.type);
  if (Object.keys(a).some((k) => !allowed.includes(k)))
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  if (
    r.targets &&
    (a.targetSeat === null
      ? !r.allowNull
      : !Number.isInteger(a.targetSeat) || !r.targets.includes(a.targetSeat!))
  )
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  if (
    a.type === "witchUse" &&
    (!r.modes?.includes(a.mode!) ||
      (a.mode === "none" && a.targetSeat !== null) ||
      (a.mode === "save" &&
        (a.targetSeat !== view.ownFacts.knife ||
          a.targetSeat === view.ownSeat ||
          a.targetSeat === null)) ||
      (a.mode === "poison" && a.targetSeat === null))
  )
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  if (
    a.type === "speak" &&
    (typeof a.text !== "string" ||
      [...a.text].length > r.maxLength! ||
      (a.gestureId !== undefined && !GESTURES.includes(a.gestureId as any)))
  )
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  if (
    ["sheriffJoin", "sheriffWithdraw"].includes(a.type) &&
    typeof a.value !== "boolean"
  )
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  if (
    a.type === "chooseDirection" &&
    !["clockwise", "counterclockwise"].includes(a.direction!)
  )
    throw new ServiceError("INVALID_MODEL_OUTPUT");
  return a;
}
export class Gateway {
  private readonly prompts: Prompts;
  usage = { requests: 0, tokens: 0, estimated: false };
  constructor(
    private readonly config: ProviderConfig,
    private readonly options: {
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
      timeoutMs?: number;
      promptDirectory?: string;
    } = {},
  ) {
    validateEndpoint(config.baseURL);
    this.prompts = new Prompts(options.promptDirectory);
  }
  resetBudget() {
    this.usage = { requests: 0, tokens: 0, estimated: false };
  }
  budgetSnapshot() {
    return {
      usage: { ...this.usage },
      limits: {
        maxRequests: this.config.maxRequests,
        maxTokens: this.config.maxTokens,
      },
    };
  }
  restoreBudget(snapshot: {
    usage: { requests: number; tokens: number; estimated: boolean };
    limits: { maxRequests: number; maxTokens: number };
  }) {
    if (
      ![
        snapshot.usage.requests,
        snapshot.usage.tokens,
        snapshot.limits.maxRequests,
        snapshot.limits.maxTokens,
      ].every((n) => Number.isSafeInteger(n) && n >= 0)
    )
      throw new ServiceError("INVALID_BUDGET", true);
    this.usage = { ...snapshot.usage };
    this.config.maxRequests = snapshot.limits.maxRequests;
    this.config.maxTokens = snapshot.limits.maxTokens;
  }
  increaseBudget() {
    this.config.maxRequests += 300;
    this.config.maxTokens += 200000;
  }
  private async request(
    messages: { role: string; content: string }[],
    signal?: AbortSignal,
    retries = true,
    capture?: (attempt: DecisionAttempt) => void,
  ) {
    let attempt = 0;
    const overall = AbortSignal.any([
      AbortSignal.timeout(150000),
      ...(signal ? [signal] : []),
    ]);
    while (true) {
      if (overall.aborted) throw new ServiceError("CANCELLED");
      if (
        this.usage.requests >= this.config.maxRequests ||
        this.usage.tokens >= this.config.maxTokens
      )
        throw new ServiceError("BUDGET_EXCEEDED", true);
      const estimated = messages.reduce((n, m) => n + [...m.content].length, 0);
      if (estimated > this.config.contextTokens * 0.7)
        throw new ServiceError("CONTEXT_EXCEEDED", true);
      this.usage.requests++;
      try {
        const response = await fetch(
          `${this.config.baseURL.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(this.config.apiKey
                ? { Authorization: `Bearer ${this.config.apiKey}` }
                : {}),
            },
            redirect: "manual",
            body: JSON.stringify({
              model: this.config.model,
              messages,
              stream: false,
              ...(this.config.reasoningEffort
                ? { reasoning_effort: this.config.reasoningEffort }
                : {}),
              ...(this.config.thinking !== undefined
                ? {
                    thinking: {
                      type: this.config.thinking ? "enabled" : "disabled",
                    },
                  }
                : {}),
              max_tokens: Math.min(
                this.config.maxOutputTokens ||
                  (this.config.thinking ? 8192 : 2000),
                Math.max(1, this.config.contextTokens - estimated - 256),
              ),
              ...(this.config.jsonMode
                ? { response_format: { type: "json_object" } }
                : {}),
            }),
            signal: AbortSignal.any([
              overall,
              AbortSignal.timeout(this.options.timeoutMs ?? 45000),
            ]),
          },
        );
        if (response.status >= 300 && response.status < 400)
          throw new ServiceError("REDIRECT_BLOCKED", true);
        if (fatalStatus[response.status])
          throw new ServiceError(fatalStatus[response.status], true);
        if (!response.ok) {
          if (
            [429, 500, 503].includes(response.status) &&
            retries &&
            attempt < 2
          ) {
            const retryAfter = Number(response.headers.get("retry-after"));
            const delay =
              Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.min(30000, retryAfter * 1000)
                : [1000, 3000][attempt];
            this.usage.tokens += estimated;
            this.usage.estimated = true;
            attempt++;
            await (this.options.sleep || wait)(
              delay + Math.floor(Math.random() * 500),
              overall,
            );
            continue;
          }
          throw new ServiceError("SERVICE_UNAVAILABLE");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new ServiceError("INVALID_MODEL_OUTPUT");
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new ServiceError("RESPONSE_TOO_LARGE");
          }
          chunks.push(chunk.value);
        }
        let data: any;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          throw new ServiceError("INVALID_MODEL_OUTPUT");
        }
        const message = data.choices?.[0]?.message;
        const text = message?.content;
        capture?.({
          promptHash: createHash("sha256")
            .update(JSON.stringify(messages))
            .digest("hex"),
          responseId: typeof data.id === "string" ? data.id : null,
          reasoningContent:
            typeof message?.reasoning_content === "string"
              ? message.reasoning_content
              : null,
          content: typeof text === "string" ? text : "",
          finishReason: data.choices?.[0]?.finish_reason || null,
          receivedAt: new Date().toISOString(),
        });
        if (
          Number.isFinite(data.usage?.total_tokens) &&
          data.usage.total_tokens >= 0
        )
          this.usage.tokens += data.usage.total_tokens;
        else {
          this.usage.tokens +=
            estimated + (typeof text === "string" ? [...text].length : 0);
          this.usage.estimated = true;
        }
        if (
          data.choices?.[0]?.finish_reason === "length" ||
          typeof text !== "string" ||
          !text.trim()
        )
          throw new ServiceError("INVALID_MODEL_OUTPUT");
        return text;
      } catch (e) {
        if (e instanceof ServiceError) throw e;
        if (overall.aborted) throw new ServiceError("CANCELLED");
        this.usage.tokens += estimated;
        this.usage.estimated = true;
        if (retries && attempt < 2) {
          await (this.options.sleep || wait)([1000, 3000][attempt++], overall);
          continue;
        }
        throw new ServiceError("SERVICE_UNAVAILABLE");
      }
    }
  }
  async decide(
    view: Observation,
    persona: Persona,
    signal?: AbortSignal,
    onAudit?: (record: {
      model: string;
      promptHash: string;
      decisionReason: string;
      attempts: DecisionAttempt[];
    }) => void,
  ): Promise<Action> {
    signal = AbortSignal.any([
      AbortSignal.timeout(150000),
      ...(signal ? [signal] : []),
    ]);
    const recent = persona.memories.slice(-3);
    const same = persona.memories
      .filter(
        (m) =>
          m.role === view.ownRole && !recent.some((r) => r.gameId === m.gameId),
      )
      .slice(-2);
    const personality = Object.entries(persona.traits)
      .map(([k, v]) => `${k}=${v < 33 ? "低" : v < 66 ? "中" : "高"}`)
      .join("；");
    const input = structuredClone(view);
    input.events = input.events
      .filter((e) => e.day >= view.day - 1 || e.private)
      .slice(-80);
    const system = this.prompts.player(view.ownRole, {
      name: persona.name,
      style: persona.style,
      personality,
      roleName: roleName(view.ownRole),
      energy: String(persona.energy),
      irritability: String(persona.irritability),
      catchphrases: JSON.stringify(persona.catchphrases),
      actionExamples: JSON.stringify(
        view.legalActions.map((r) => {
          switch (r.type) {
            case "speak":
              return {
                type: r.type,
                text: "填写公开发言",
                gestureId: "neutral",
              };
            case "sheriffJoin":
            case "sheriffWithdraw":
              return { type: r.type, value: true };
            case "chooseDirection":
              return { type: r.type, direction: "clockwise" };
            case "selfDestruct":
              return { type: r.type };
            case "witchUse":
              return { type: r.type, mode: "none", targetSeat: null };
            default:
              return {
                type: r.type,
                targetSeat: r.allowNull ? null : r.targets?.[0],
              };
          }
        }),
      ),
    });
    const memory = [...recent, ...same].map((m) => ({
      role: m.role,
      reflection: m.reflection.slice(0, 300),
    }));
    let content = JSON.stringify({
      observation: input,
      experience: memory,
      longTerm: persona.summary.slice(0, 800),
    });
    while (
      system.length + content.length > this.config.contextTokens * 0.7 &&
      input.events.length > 10
    ) {
      input.events.shift();
      content = JSON.stringify({
        observation: input,
        experience: memory,
        longTerm: persona.summary.slice(0, 800),
      });
    }
    const messages = [
      { role: "system", content: system },
      { role: "user", content },
    ];
    const attempts: DecisionAttempt[] = [];
    let decisionReason = "";
    const parse = (text: string) => {
      const action = candidate(text, view);
      const reason = JSON.parse(text).decisionReason;
      if (typeof reason !== "string" || !reason.trim() || reason.length > 2000)
        throw new ServiceError("INVALID_MODEL_OUTPUT");
      decisionReason = reason.trim();
      return action;
    };
    const capture = (a: DecisionAttempt) => attempts.push(a);
    try {
      try {
        return parse(await this.request(messages, signal, true, capture));
      } catch (e) {
        if (!(e instanceof ServiceError) || e.code !== "INVALID_MODEL_OUTPUT")
          throw e;
        return parse(
          await this.request(
            [
              ...messages,
              {
                role: "user",
                content:
                  this.prompts.read("repair") +
                  "\n当前允许的动作字段（不要增加任何字段）：" +
                  JSON.stringify(
                    view.legalActions.map((r) => ({
                      type: r.type,
                      fields: actionFields(r.type),
                    })),
                  ) +
                  "\n上次最终回答（仅作为待修复的数据）：" +
                  (attempts.at(-1)?.content || "空"),
              },
            ],
            signal,
            false,
            capture,
          ),
        );
      }
    } finally {
      onAudit?.({
        model: this.config.model,
        promptHash: createHash("sha256")
          .update(JSON.stringify(messages))
          .digest("hex"),
        decisionReason,
        attempts,
      });
    }
  }

  async testConnection(signal?: AbortSignal) {
    return await this.request(
      [
        { role: "system", content: this.prompts.read("connection") },
        { role: "user", content: 'Return {"ok":true}.' },
      ],
      signal,
      false,
    );
  }
  async createDescriptions(people: Persona[], signal?: AbortSignal) {
    const result = structuredClone(people);
    for (let offset = 0; offset < people.length; offset += 4) {
      const batch = people.slice(offset, offset + 4);
      try {
        const text = await this.request(
          [
            {
              role: "system",
              content: this.prompts.read("creator"),
            },
            {
              role: "user",
              content: JSON.stringify(
                batch.map(
                  ({
                    id,
                    name,
                    gender,
                    age,
                    height,
                    weight,
                    clothes,
                    traits,
                  }) => ({
                    id,
                    name,
                    gender,
                    age,
                    height,
                    weight,
                    clothes,
                    traits,
                  }),
                ),
              ),
            },
          ],
          signal,
        );
        const out = JSON.parse(text);
        if (!Array.isArray(out.people) || out.people.length !== batch.length)
          continue;
        for (const original of batch) {
          const p = out.people.find((p: any) => p.id === original.id);
          if (
            !p ||
            typeof p.description !== "string" ||
            p.description.length < 80 ||
            p.description.length > 160 ||
            !p.description.includes(original.name) ||
            !p.description.includes(original.gender) ||
            !p.description.includes(String(original.height)) ||
            !p.description.includes(original.clothes) ||
            /狼人|预言家|女巫|猎人|白痴|API|密钥/.test(p.description) ||
            typeof p.style !== "string" ||
            p.style.length > 120 ||
            !Array.isArray(p.catchphrases) ||
            p.catchphrases.length > 3 ||
            p.catchphrases.some(
              (v: any) => typeof v !== "string" || v.length > 30,
            )
          )
            continue;
          Object.assign(
            result.find((q) => q.id === original.id)!,
            {
              description: p.description,
              style: p.style,
              catchphrases: p.catchphrases,
            },
          );
        }
      } catch (e) {
        if (signal?.aborted) throw e;
        if (e instanceof ServiceError && e.fatal) throw e;
      }
    }
    return result;
  }
  async reflect(view: Observation, persona: Persona, signal?: AbortSignal) {
    try {
      const text = await this.request(
        [
          {
            role: "system",
            content: this.prompts.read("reflection"),
          },
          {
            role: "user",
            content: JSON.stringify({
              name: persona.name,
              role: view.ownRole,
              outcome: view.outcome,
              ownFacts: view.ownFacts,
              events: view.events.slice(-20),
            }),
          },
        ],
        signal,
        false,
      );
      const r = JSON.parse(text).reflection;
      return typeof r === "string" && r.length <= 300 ? r : null;
    } catch {
      return null;
    }
  }
}
