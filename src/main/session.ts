import { randomInt, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  Action,
  Command,
  GameState,
  Observation,
} from "../domain/types.js";
import {
  createGame,
  submit,
  abortGame,
  defaultAction,
  fullReview,
} from "../domain/engine.js";
import { observe } from "../domain/visibility.js";
import { PRESETS } from "../domain/resources.js";
import { Store } from "../storage/store.js";
import {
  createRoster,
  selectFriends,
  publicDescription,
  restRoster,
  updateRosterAfterMatch,
  type Roster,
} from "../agents/personas.js";
import { demoDecision } from "../agents/player.js";
import { Gateway, ServiceError } from "../llm/gateway.js";
export interface SessionView {
  observation: Observation;
  paused: boolean;
  notice: string;
  mode: "model" | "demo";
  displayed: number;
  presentationTarget: number;
  usage: { requests: number; tokens: number; estimated: boolean };
  finishing: boolean;
  usageVisible: boolean;
}
export class Session extends EventEmitter {
  private state: GameState | null = null;
  private roster!: Roster;
  private mode: "model" | "demo" = "demo";
  private paused = false;
  private notice = "";
  private displayed = 0;
  private serial: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private jobs = new Map<string, AbortController>();
  private failures = 0;
  private epoch = 0;
  private finishing = false;
  private reflectionController: AbortController | null = null;
  private pendingCandidate: GameState | null = null;
  constructor(
    readonly store: Store,
    private gateway: Gateway | null,
  ) {
    super();
  }
  async initialize() {
    this.roster =
      (await this.store.loadRoster()) || createRoster(randomInt(1, 0x7fffffff));
    await this.store.saveRoster(this.roster);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.serial.then(fn);
    this.serial = p.catch(() => {});
    return p;
  }
  private publish() {
    this.emit("change", this.view());
  }
  lobby() {
    return {
      presets: PRESETS,
      people: this.roster.people.map((p) => ({
        id: p.id,
        name: p.name,
        description: publicDescription(p),
        games: p.experienceCount,
      })),
      restAvailable: this.roster.restAvailable,
      activeMatch: this.state && !this.state.outcome ? this.state.id : null,
      modelAvailable: !!this.gateway,
    };
  }
  view(): SessionView | null {
    if (!this.state) return null;
    const o = observe(this.state, 1);
    const target = o.events.length;
    if (this.displayed < target || this.paused || this.finishing)
      o.legalActions = [];
    return {
      observation: o,
      paused: this.paused,
      notice: this.notice,
      mode: this.mode,
      displayed: this.displayed,
      presentationTarget: target,
      usage:
        this.state.outcome && this.mode === "model"
          ? {
              ...(this.gateway?.usage ||
                this.state.runtime?.usage || {
                  requests: 0,
                  tokens: 0,
                  estimated: false,
                }),
            }
          : { requests: 0, tokens: 0, estimated: false },
      finishing: this.finishing,
      usageVisible: !!this.state.outcome,
    };
  }
  async start(options: {
    count: number;
    humanRole?: any;
    humanName?: string;
    mode?: "model" | "demo";
  }) {
    return this.exclusive(async () => {
      if (this.state && !this.state.outcome)
        throw new Error("MATCH_IN_PROGRESS");
      if (this.finishing) throw new Error("REFLECTION_PENDING");
      if (
        !Number.isInteger(options.count) ||
        options.count < 6 ||
        options.count > 14 ||
        (options.humanName && options.humanName.length > 20)
      )
        throw new Error("INVALID_SETUP");
      this.mode = options.mode || (this.gateway ? "model" : "demo");
      if (!["demo", "model"].includes(this.mode))
        throw new Error("INVALID_MODE");
      if (this.mode === "model" && !this.gateway)
        throw new Error("CONFIG_MISSING");
      this.cancel();
      this.pendingCandidate = null;
      const seed = randomInt(1, 2 ** 48 - 1);
      const friends = selectFriends(this.roster, options.count - 1, seed);
      const next = createGame({
        ...options,
        seed,
        friends: friends.map((p) => ({
          playerId: p.id,
          name: p.name,
          description: publicDescription(p),
        })),
      });
      this.gateway?.resetBudget();
      next.runtime = {
        mode: this.mode,
        rosterSnapshot: {
          ...structuredClone(this.roster),
          active: friends.map((p) => p.id),
        },
        ...(this.gateway?.budgetSnapshot() || {
          usage: { requests: 0, tokens: 0, estimated: false },
          limits: { maxRequests: 300, maxTokens: 200000 },
        }),
      };
      await this.store.commit(next);
      const roster = structuredClone(this.roster);
      roster.active = friends.map((p) => p.id);
      await this.store.saveRoster(roster);
      this.roster = roster;
      this.state = next;
      this.displayed = 0;
      this.paused = false;
      this.notice =
        this.mode === "demo"
          ? "离线演示：朋友使用规则脚本，不会调用模型。"
          : "";
      this.failures = 0;
      this.gateway?.resetBudget();
      this.publish();
      this.schedule();
      return this.view();
    });
  }
  async load(id: string, restoreFriends = false) {
    return this.exclusive(async () => {
      if (this.state && !this.state.outcome)
        throw new Error("MATCH_IN_PROGRESS");
      const next = await this.store.load(id);
      if (!next) throw new Error("SAVE_NOT_FOUND");
      const missingFriends = next.players.some(
        (p) =>
          p.playerId && !this.roster.people.some((q) => q.id === p.playerId),
      );
      if (missingFriends) {
        const snapshot = next.runtime?.rosterSnapshot;
        if (
          !restoreFriends ||
          !snapshot ||
          snapshot.schemaVersion !== 1 ||
          snapshot.people.length !== 20
        )
          throw new Error("ROSTER_MISMATCH");
        await this.store.backupRoster();
        await this.store.saveRoster(snapshot);
        this.roster = structuredClone(snapshot);
      }
      this.cancel();
      this.pendingCandidate = null;
      this.state = next;
      this.mode = next.runtime?.mode || "demo";
      if (next.runtime && this.mode === "model")
        this.gateway?.restoreBudget(next.runtime);
      if (
        next.outcome &&
        next.outcome.status !== "aborted" &&
        !this.roster.processedMatches.includes(next.id)
      ) {
        const roster = updateRosterAfterMatch(this.roster, next);
        await this.store.saveRoster(roster);
        this.roster = roster;
      }
      this.displayed = 0;
      this.paused = true;
      this.notice = "已恢复存档，点击继续后推进；已锁定动作保留。";
      this.publish();
      return this.view();
    });
  }
  async act(command: Command) {
    return this.exclusive(async () => {
      if (!this.state) throw new Error("NO_MATCH");
      if (this.paused || this.finishing) throw new Error("PAUSED");
      if (this.displayed < observe(this.state, 1).events.length)
        throw new Error("PRESENTATION_PENDING");
      await this.commit(submit(this.state, 1, command));
      return this.view();
    });
  }
  async ack(eventId: string) {
    return this.exclusive(async () => {
      if (!this.state) return null;
      const n = Number(eventId?.replace(/^v/, ""));
      if (
        !/^v\d+$/.test(eventId) ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > observe(this.state, 1).events.length
      )
        throw new Error("INVALID_EVENT");
      this.displayed = Math.max(this.displayed, n);
      this.publish();
      this.schedule();
      return this.view();
    });
  }
  pause() {
    this.paused = true;
    this.cancel();
    this.publish();
  }
  async resume() {
    return this.exclusive(async () => {
      if (!this.state) return;
      if (this.mode === "model" && !this.gateway) {
        this.paused = true;
        this.notice = "模型局需要有效服务配置，请先配置并重新读取。";
        this.publish();
        return;
      }
      if (this.pendingCandidate) await this.commit(this.pendingCandidate);
      this.paused = false;
      this.notice = this.mode === "demo" ? "离线演示：朋友使用规则脚本。" : "";
      this.failures = 0;
      this.publish();
      this.schedule();
    });
  }
  private cancel() {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const c of this.jobs.values()) c.abort();
    this.jobs.clear();
    this.reflectionController?.abort();
  }
  async abandon() {
    return this.exclusive(async () => {
      if (!this.state) return;
      this.cancel();
      if (this.pendingCandidate) await this.commit(this.pendingCandidate);
      await this.commit(abortGame(this.state));
    });
  }
  async review() {
    if (!this.state) throw new Error("NO_MATCH");
    return fullReview(this.state);
  }
  async rest() {
    return this.exclusive(async () => {
      if (this.state && !this.state.outcome)
        throw new Error("MATCH_IN_PROGRESS");
      const next = restRoster(this.roster);
      await this.store.saveRoster(next);
      this.roster = next;
      return this.lobby();
    });
  }
  async initializeFriends(useModel: boolean) {
    return this.exclusive(async () => {
      if (this.state && !this.state.outcome)
        throw new Error("MATCH_IN_PROGRESS");
      if (this.finishing) throw new Error("REFLECTION_PENDING");
      let next = createRoster(randomInt(1, 0x7fffffff));
      if (useModel) {
        if (!this.gateway) throw new Error("CONFIG_MISSING");
        this.notice = "正在创造20位新朋友，旧人物库会在成功后替换。";
        this.publish();
        next.people = await this.gateway.createDescriptions(next.people);
      }
      await this.store.backupRoster();
      await this.store.saveRoster(next);
      this.roster = next;
      this.notice = "";
      this.publish();
      return this.lobby();
    });
  }
  setGateway(gateway: Gateway | null) {
    this.pause();
    const budget = this.gateway?.budgetSnapshot() || this.state?.runtime;
    this.gateway = gateway;
    if (budget && this.state && !this.state.outcome)
      gateway?.restoreBudget(budget);
  }
  increaseBudget() {
    this.gateway?.increaseBudget();
  }
  async removeSave(id: string) {
    return this.exclusive(async () => {
      if (this.state?.id === id && !this.state.outcome)
        throw new Error("MATCH_IN_PROGRESS");
      await this.store.remove(id);
    });
  }
  private async commit(next: GameState) {
    if (this.state === next) return;
    if (this.mode === "model" && this.gateway)
      next.runtime = {
        ...next.runtime,
        mode: this.mode,
        ...this.gateway.budgetSnapshot(),
      };
    try {
      await this.store.commit(next);
    } catch {
      this.pendingCandidate = next;
      this.paused = true;
      this.notice = "存档写入失败，游戏已暂停；请检查磁盘后重试。";
      this.cancel();
      this.publish();
      throw new Error("STORAGE_FAILED");
    }
    this.state = next;
    this.pendingCandidate = null;
    this.publish();
    if (
      next.outcome &&
      next.outcome.status !== "aborted" &&
      !this.roster.processedMatches.includes(next.id)
    ) {
      await this.finish(next);
    }
    this.schedule();
  }
  private async finish(state: GameState) {
    this.finishing = true;
    this.publish();
    const controller = new AbortController();
    this.reflectionController = controller;
    try {
      const next = updateRosterAfterMatch(this.roster, state);
      await this.store.saveRoster(next);
      this.roster = next;
      if (this.mode === "model" && this.gateway) {
        for (const p of next.people.filter((p) =>
          state.players.some((q) => q.playerId === p.id),
        )) {
          if (controller.signal.aborted) break;
          const seat = state.players.find((q) => q.playerId === p.id)!.seat;
          const reflection = await this.gateway.reflect(
            observe(state, seat),
            p,
            controller.signal,
          );
          if (reflection) {
            const memory = p.memories.find((m) => m.gameId === state.id);
            if (memory) memory.reflection = reflection;
          }
        }
        await this.store.saveRoster(next);
      }
      this.roster = next;
    } catch {
      this.paused = true;
      this.notice = "本局已保存，朋友经验写入失败；恢复存档时将补写模板经验。";
    } finally {
      controller.abort();
      if (this.reflectionController === controller)
        this.reflectionController = null;
      this.finishing = false;
      this.publish();
    }
  }
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, 60);
  }
  private pump() {
    const s = this.state;
    if (
      !s ||
      s.outcome ||
      this.paused ||
      this.finishing ||
      this.displayed < observe(s, 1).events.length
    )
      return;
    for (const seat of s.window.actors) {
      if (this.jobs.size >= 2) break;
      if (seat === 1 || Object.hasOwn(s.window.answers, seat)) continue;
      const key = `${s.window.id}:${seat}`;
      if (this.jobs.has(key)) continue;
      const controller = new AbortController();
      this.jobs.set(key, controller);
      const epoch = this.epoch;
      const snapshot = observe(s, seat);
      const persona = this.roster.people.find(
        (p) => p.id === s.players[seat - 1].playerId,
      )!;
      void (async () => {
        let action: Action;
        try {
          action =
            this.mode === "model"
              ? await this.gateway!.decide(snapshot, persona, controller.signal)
              : demoDecision(snapshot, persona);
          this.failures = 0;
        } catch (e) {
          if (controller.signal.aborted) return;
          if (e instanceof ServiceError && e.fatal) {
            this.paused = true;
            this.notice = `模型连接需要处理：${e.code}。检查配置或增加预算后继续。`;
            this.cancel();
            this.publish();
            return;
          }
          action = defaultAction(snapshot);
          this.failures++;
          if (this.failures >= 3) {
            this.paused = true;
            this.notice = "连续3次模型动作失败，已暂停。可以检查服务后重试。";
            this.cancel();
            this.publish();
            return;
          }
        }
        await this.exclusive(async () => {
          if (
            controller.signal.aborted ||
            epoch !== this.epoch ||
            this.paused ||
            !this.state ||
            this.state.window.id !== snapshot.windowId ||
            Object.hasOwn(this.state.window.answers, seat)
          )
            return;
          const next = submit(this.state, seat, {
            commandId: randomUUID(),
            windowId: snapshot.windowId!,
            action,
          });
          await this.commit(next);
        });
      })()
        .catch(() => {
          if (!controller.signal.aborted) {
            this.paused = true;
            this.notice = "动作处理失败，游戏已暂停，未接受的动作可以重试。";
            this.cancel();
            this.publish();
          }
        })
        .finally(() => {
          if (this.jobs.get(key) === controller) this.jobs.delete(key);
          this.schedule();
        });
    }
  }
  async idle() {
    await this.serial;
  }
}
