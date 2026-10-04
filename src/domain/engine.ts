import { randomUUID } from "node:crypto";
import type {
  Action,
  Command,
  GameState,
  Observation,
  Phase,
  Role,
} from "./types.js";
import { GESTURES } from "./types.js";
import { PRESETS, ROLES, roleName, validatePresets } from "./resources.js";
import { digest, random, shuffle } from "./random.js";
import { legalActions } from "./visibility.js";

export interface Setup {
  gameId?: string;
  count: number;
  seed: number;
  humanRole?: Role;
  friends?: { playerId: string; name: string; description: string }[];
  humanName?: string;
}
const alive = (s: GameState) =>
  s.players.filter((p) => p.alive).map((p) => p.seat);
const player = (s: GameState, seat: number) => s.players[seat - 1];
function event(
  s: GameState,
  type: string,
  text: string,
  audience: "public" | "host" | number[] = "public",
  seat?: number,
  data?: unknown,
) {
  s.events.push({
    day: s.day,
    type,
    text,
    audience,
    ...(seat !== undefined ? { seat } : {}),
    ...(data !== undefined ? { data } : {}),
  });
}
function open(s: GameState, phase: Phase, actors: number[]) {
  s.phase = phase;
  s.windowCount++;
  s.window = {
    id: digest(`${s.id}:${s.seed}:window:${s.windowCount}`).slice(0, 24),
    actors,
    answers: {},
  };
}
function speech(s: GameState, phase: Phase, seats: number[]) {
  s.queue = [...seats];
  if (s.queue.length) open(s, phase, [s.queue[0]]);
  else afterSpeech(s, phase);
}
function end(
  s: GameState,
  status: NonNullable<GameState["outcome"]>["status"],
  reason: string,
) {
  s.outcome = { status, reason };
  open(s, "ended", []);
  event(s, "result", `本局结束：${reason}`);
}
export function victory(s: GameState): GameState["outcome"] {
  const living = s.players.filter((p) => p.alive);
  if (!living.some((p) => p.role === "wolf"))
    return { status: "good_win", reason: "全部狼人已出局，好人胜利" };
  const good = living.filter((p) => p.role !== "wolf");
  if (s.preset.winMode === "city" && !good.length)
    return { status: "wolf_win", reason: "全部好人已出局，狼人胜利" };
  if (
    s.preset.winMode === "edge" &&
    (!good.some((p) => p.role === "villager") ||
      !good.some((p) => p.role !== "villager"))
  )
    return { status: "wolf_win", reason: "平民或神职已全部出局，狼人胜利" };
  return null;
}
function nextNight(s: GameState) {
  if (s.day >= s.preset.maxDays) {
    end(s, "draw", "第30日结束仍未分胜负，和局");
    return;
  }
  s.day++;
  startNight(s);
}
function startNight(s: GameState) {
  s.night = { alive: alive(s), knife: null, saved: false, poison: null };
  event(s, "host", "天黑请闭眼。狼人请确认行动。");
  open(
    s,
    "wolfVote",
    s.players.filter((p) => p.alive && p.role === "wolf").map((p) => p.seat),
  );
}
export function createGame(setup: Setup): GameState {
  validatePresets();
  const preset = PRESETS.find((p) => p.count === setup.count);
  if (!preset || !Number.isSafeInteger(setup.seed))
    throw new Error("INVALID_SETUP");
  const rng = Object.fromEntries(
    ["deal", "tie", "discussion"].map((k) => [
      k,
      parseInt(digest(`${setup.seed}:${k}`).slice(0, 8), 16),
    ]),
  );
  let cards = shuffle(
    Object.entries(preset.roles).flatMap(
      ([r, n]) => Array(n).fill(r) as Role[],
    ),
    rng,
    "deal",
  );
  if (setup.humanRole) {
    const i = cards.indexOf(setup.humanRole);
    if (i < 0) throw new Error("INVALID_ROLE");
    [cards[0], cards[i]] = [cards[i], cards[0]];
  }
  const s: GameState = {
    schemaVersion: 1,
    id: setup.gameId || `game-${randomUUID()}`,
    seed: setup.seed,
    rng,
    windowCount: 0,
    version: 0,
    day: 1,
    phase: "wolfVote",
    preset: structuredClone(preset),
    players: cards.map((role, i) => ({
      seat: i + 1,
      actor: i === 0 ? "human" : "ai",
      playerId:
        i === 0 ? null : (setup.friends?.[i - 1]?.playerId ?? `friend-${i}`),
      name:
        i === 0
          ? setup.humanName?.trim().slice(0, 20) || "我"
          : (setup.friends?.[i - 1]?.name ?? `朋友${i}`),
      description:
        i === 0
          ? "桌上唯一的真人玩家。"
          : (setup.friends?.[i - 1]?.description ??
            "认真地坐在桌前，等待这一局开始。"),
      role,
      alive: true,
      voteEligible: true,
      exileEligible: true,
      revealedRole: null,
      gesture: "neutral",
    })),
    abilities: {},
    window: { id: "", actors: [], answers: {} },
    queue: [],
    events: [],
    commands: {},
    sheriff: null,
    badgeDestroyed: false,
    candidates: [],
    originalCandidates: [],
    electors: [],
    pk: [],
    night: { alive: [], knife: null, saved: false, poison: null },
    death: { hunters: [], words: [], continuation: "dawn" },
    outcome: null,
    practice: !!setup.humanRole,
  };
  for (const p of s.players)
    s.abilities[p.seat] = { save: true, poison: true, shot: false, checks: [] };
  event(
    s,
    "host",
    `${setup.count}人局开始。请保守自己的身份；夜晚只会显示你有权看到的信息。`,
  );
  startNight(s);
  return s;
}
function tally(s: GameState, weighted: boolean) {
  const counts = new Map<number | null, number>();
  for (const [seat, a] of Object.entries(s.window.answers)) {
    const target = a.targetSeat ?? null;
    counts.set(
      target,
      (counts.get(target) || 0) +
        (weighted && Number(seat) === s.sheriff ? 3 : weighted ? 2 : 1),
    );
  }
  return counts;
}
function top(s: GameState, weighted: boolean, includeNull = false) {
  const counts = tally(s, weighted);
  if (!includeNull) counts.delete(null);
  const max = Math.max(0, ...counts.values());
  return [...counts]
    .filter(([, v]) => v === max && max > 0)
    .map(([key]) => key);
}
function privateRole(s: GameState, role: Role) {
  return s.players
    .filter((p) => s.night.alive.includes(p.seat) && p.role === role)
    .map((p) => p.seat);
}
function afterWolves(s: GameState) {
  const highest = top(s, false, true);
  s.night.knife = highest.length
    ? highest[Math.floor(random(s.rng, "tie") * highest.length)]
    : null;
  event(s, "audit", "暗杀票聚合完成", "host", undefined, s.window.answers);
  event(
    s,
    "private",
    s.night.knife === null
      ? "今晚空刀。"
      : `今晚最终刀口：${s.night.knife}号。`,
    privateRole(s, "wolf"),
  );
  event(s, "host", "狼人请闭眼。预言家请确认行动。");
  const seers = privateRole(s, "seer");
  if (seers.length) open(s, "seerCheck", seers);
  else afterSeer(s);
}
function afterSeer(s: GameState) {
  event(s, "host", "预言家请闭眼。女巫请确认行动。");
  const witches = privateRole(s, "witch");
  if (witches.length) open(s, "witchUse", witches);
  else dawn(s);
}
function dawn(s: GameState) {
  event(s, "host", "女巫请闭眼。天亮了，请睁眼。");
  const deaths = new Map<number, string[]>();
  if (s.night.knife !== null && !s.night.saved)
    deaths.set(s.night.knife, ["wolfAttack"]);
  if (s.night.poison !== null)
    deaths.set(s.night.poison, [
      ...(deaths.get(s.night.poison) || []),
      "poison",
    ]);
  s.death = {
    hunters: [],
    words: s.day === 1 ? [...deaths.keys()].sort((a, b) => a - b) : [],
    continuation: "dawn",
  };
  kill(s, deaths, true);
  deathQueue(s);
}
function kill(s: GameState, deaths: Map<number, string[]>, night = false) {
  const seats = [...deaths.keys()].sort((a, b) => a - b);
  for (const seat of seats) {
    const p = player(s, seat);
    if (!p.alive) continue;
    p.alive = false;
    const reasons = deaths.get(seat)!;
    if (
      p.role === "hunter" &&
      !s.abilities[seat].shot &&
      !reasons.includes("poison") &&
      (reasons.includes("wolfAttack") || reasons.includes("exile"))
    )
      s.death.hunters.push(seat);
  }
  if (night)
    event(
      s,
      "result",
      seats.length
        ? `昨夜出局：${seats.map((i) => `${i}号`).join("、")}。`
        : "昨夜是平安夜。",
    );
  event(s, "audit", "死亡效果", "host", undefined, Object.fromEntries(deaths));
}
function deathQueue(s: GameState) {
  if (s.death.hunters.length) {
    open(s, "hunterShoot", [s.death.hunters.shift()!]);
    return;
  }
  const result = victory(s);
  if (result) {
    end(s, result.status, result.reason);
    return;
  }
  if (
    s.sheriff !== null &&
    (!player(s, s.sheriff).alive || !player(s, s.sheriff).voteEligible)
  ) {
    open(s, "badgeTransfer", [s.sheriff]);
    return;
  }
  afterDeath(s);
}
function afterDeath(s: GameState) {
  if (s.death.continuation === "selfDestruct") {
    nextNight(s);
    return;
  }
  if (s.death.continuation === "exile") {
    speech(s, "exileLastWords", s.death.words);
    return;
  }
  if (s.day === 1 && s.preset.sheriff) {
    event(s, "host", "首日警长竞选，请选择是否上警。");
    open(
      s,
      "sheriffJoin",
      alive(s).filter((i) => player(s, i).voteEligible),
    );
  } else dawnWords(s);
}
function dawnWords(s: GameState) {
  speech(s, "lastWords", s.death.words);
}
function discussion(s: GameState) {
  if (s.sheriff !== null) {
    open(s, "direction", [s.sheriff]);
    return;
  }
  const seats = alive(s);
  const start = Math.floor(random(s.rng, "discussion") * seats.length);
  event(s, "host", "请依次发表观点。发言中的身份和推测未经验证。");
  speech(s, "discussion", [...seats.slice(start), ...seats.slice(0, start)]);
}
function ordered(s: GameState, reverse: boolean) {
  const n = s.players.length;
  const seats: number[] = [];
  for (let i = 1; i <= n; i++) {
    const seat = ((((s.sheriff! - 1 + (reverse ? -i : i)) % n) + n) % n) + 1;
    if (player(s, seat).alive) seats.push(seat);
  }
  return seats;
}
function afterSpeech(s: GameState, phase: Phase) {
  switch (phase) {
    case "discussion":
      event(s, "host", "开始放逐投票，所有人锁票后统一公布。");
      open(
        s,
        "exileVote",
        alive(s).filter((i) => player(s, i).voteEligible),
      );
      if (!s.window.actors.length) nextNight(s);
      break;
    case "lastWords":
      discussion(s);
      break;
    case "exileLastWords":
      nextNight(s);
      break;
    case "sheriffSpeech":
      open(s, "sheriffWithdraw", s.candidates);
      break;
    case "sheriffPKSpeech":
      open(s, "sheriffPKVote", s.electors);
      if (!s.electors.length) noSheriff(s);
      break;
    case "pkSpeech":
      open(
        s,
        "pkVote",
        alive(s).filter((i) => player(s, i).voteEligible && !s.pk.includes(i)),
      );
      if (!s.window.actors.length) {
        event(s, "result", "没有合格复投者，本日无人放逐。");
        nextNight(s);
      }
      break;
  }
}
function noSheriff(s: GameState) {
  s.sheriff = null;
  event(s, "result", "本局没有警长。");
  dawnWords(s);
}
function elected(s: GameState, seat: number) {
  s.sheriff = seat;
  event(s, "result", `${seat}号当选警长。`);
  dawnWords(s);
}
function electionVote(s: GameState) {
  s.electors = alive(s).filter(
    (i) => player(s, i).voteEligible && !s.originalCandidates.includes(i),
  );
  if (!s.candidates.length) {
    noSheriff(s);
    return;
  }
  if (s.candidates.length === 1) {
    elected(s, s.candidates[0]);
    return;
  }
  if (!s.electors.length) {
    noSheriff(s);
    return;
  }
  open(s, "sheriffVote", s.electors);
}
function publishVotes(s: GameState) {
  event(
    s,
    "votes",
    Object.entries(s.window.answers)
      .map(
        ([seat, a]) =>
          `${seat}号 → ${a.targetSeat === null || a.targetSeat === undefined ? "弃票" : `${a.targetSeat}号`}${s.sheriff === Number(seat) && (s.phase === "exileVote" || s.phase === "pkVote") ? "（1.5票）" : ""}`,
      )
      .join("；"),
  );
}
function resolveVotes(s: GameState) {
  const election = s.phase === "sheriffVote" || s.phase === "sheriffPKVote";
  publishVotes(s);
  const leaders = top(s, !election).filter((i): i is number => i !== null);
  if (election) {
    if (leaders.length === 1) elected(s, leaders[0]);
    else if (leaders.length > 1 && s.phase === "sheriffVote") {
      s.candidates = leaders;
      speech(s, "sheriffPKSpeech", leaders);
    } else noSheriff(s);
    return;
  }
  if (leaders.length === 1) {
    exile(s, leaders[0]);
    return;
  }
  if (leaders.length > 1 && s.phase === "exileVote") {
    s.pk = leaders.sort((a, b) => a - b);
    event(s, "host", `最高票平票：${s.pk.join("、")}号，请进行PK发言。`);
    speech(s, "pkSpeech", s.pk);
    return;
  }
  event(s, "result", "本日无人放逐。");
  nextNight(s);
}
function exile(s: GameState, seat: number) {
  const p = player(s, seat);
  s.death = { hunters: [], words: [], continuation: "exile" };
  if (p.role === "idiot" && p.revealedRole === null) {
    p.revealedRole = "idiot";
    p.voteEligible = false;
    p.exileEligible = false;
    event(s, "skill", `${seat}号翻牌为白痴，免于放逐，失去投票与被放逐资格。`);
    deathQueue(s);
    return;
  }
  event(s, "result", `${seat}号被放逐。`);
  s.death.words = [seat];
  kill(s, new Map([[seat, ["exile"]]]));
  deathQueue(s);
}
function advance(s: GameState) {
  switch (s.phase) {
    case "wolfVote":
      afterWolves(s);
      break;
    case "seerCheck":
      afterSeer(s);
      break;
    case "witchUse":
      dawn(s);
      break;
    case "hunterShoot":
      deathQueue(s);
      break;
    case "badgeTransfer":
      afterDeath(s);
      break;
    case "sheriffJoin":
      s.originalCandidates = Object.entries(s.window.answers)
        .filter(([, a]) => a.value)
        .map(([i]) => Number(i));
      s.candidates = [...s.originalCandidates];
      event(
        s,
        "result",
        s.candidates.length
          ? `上警：${s.candidates.join("、")}号。`
          : "无人上警。",
      );
      if (s.candidates.length) speech(s, "sheriffSpeech", s.candidates);
      else noSheriff(s);
      break;
    case "sheriffWithdraw":
      s.candidates = s.candidates.filter((i) => !s.window.answers[i].value);
      event(
        s,
        "result",
        s.candidates.length
          ? `继续竞选：${s.candidates.join("、")}号。`
          : "全部候选人退水。",
      );
      electionVote(s);
      break;
    case "sheriffVote":
    case "sheriffPKVote":
    case "exileVote":
    case "pkVote":
      resolveVotes(s);
      break;
    default: {
      const phase = s.phase;
      s.queue.shift();
      if (s.queue.length) open(s, phase, [s.queue[0]]);
      else afterSpeech(s, phase);
    }
  }
}
function validate(s: GameState, seat: number, a: Action) {
  if (!a || typeof a !== "object" || Array.isArray(a))
    throw new Error("INVALID_PAYLOAD");
  const choices = legalActions(s, seat);
  const rule = choices.find((r) => r.type === a.type);
  if (!rule) throw new Error("INVALID_PAYLOAD");
  const allowed =
    a.type === "speak"
      ? ["type", "text", "gestureId"]
      : a.type === "witchUse"
        ? ["type", "mode", "targetSeat"]
        : ["sheriffJoin", "sheriffWithdraw"].includes(a.type)
          ? ["type", "value"]
          : a.type === "chooseDirection"
            ? ["type", "direction"]
            : a.type === "selfDestruct"
              ? ["type"]
              : ["type", "targetSeat"];
  if (Object.keys(a).some((k) => !allowed.includes(k)))
    throw new Error("INVALID_PAYLOAD");
  if (rule.targets) {
    if (a.targetSeat === null) {
      if (!rule.allowNull) throw new Error("INVALID_TARGET");
    } else if (
      !Number.isInteger(a.targetSeat) ||
      !rule.targets.includes(a.targetSeat!)
    )
      throw new Error("INVALID_TARGET");
  }
  if (a.type === "witchUse") {
    if (!rule.modes?.includes(a.mode!)) throw new Error("INVALID_PAYLOAD");
    if (a.mode === "none" && a.targetSeat !== null)
      throw new Error("INVALID_TARGET");
    if (
      a.mode === "save" &&
      (a.targetSeat !== s.night.knife ||
        a.targetSeat === seat ||
        a.targetSeat === null)
    )
      throw new Error("INVALID_TARGET");
    if (a.mode === "poison" && a.targetSeat === null)
      throw new Error("INVALID_TARGET");
  }
  if (
    ["sheriffJoin", "sheriffWithdraw"].includes(a.type) &&
    typeof a.value !== "boolean"
  )
    throw new Error("INVALID_PAYLOAD");
  if (
    a.type === "chooseDirection" &&
    !["clockwise", "counterclockwise"].includes(a.direction!)
  )
    throw new Error("INVALID_PAYLOAD");
  if (
    a.type === "speak" &&
    (typeof a.text !== "string" ||
      [...a.text].length > rule.maxLength! ||
      (a.gestureId !== undefined && !GESTURES.includes(a.gestureId as any)))
  )
    throw new Error("INVALID_PAYLOAD");
}
export function submit(
  original: GameState,
  seat: number,
  command: Command,
): GameState {
  if (
    !command ||
    typeof command.commandId !== "string" ||
    !command.commandId ||
    command.commandId.length > 100 ||
    typeof command.windowId !== "string" ||
    !Number.isInteger(seat) ||
    seat < 1 ||
    seat > original.players.length
  )
    throw new Error("INVALID_PAYLOAD");
  const fingerprint = JSON.stringify({
    windowId: command.windowId,
    action: command.action,
  });
  const prior = original.commands[command.commandId];
  if (prior) {
    if (prior.seat !== seat || prior.fingerprint !== fingerprint)
      throw new Error("DUPLICATE_CONFLICT");
    return original;
  }
  if (original.outcome) throw new Error("GAME_ENDED");
  if (original.window.id !== command.windowId) throw new Error("WINDOW_CLOSED");
  if (
    !original.window.actors.includes(seat) ||
    Object.hasOwn(original.window.answers, seat)
  )
    throw new Error("NOT_ELIGIBLE");
  validate(original, seat, command.action);
  const s = structuredClone(original);
  const a = command.action;
  s.version++;
  s.commands[command.commandId] = { seat, fingerprint };
  s.window.answers[seat] = a;
  event(s, "action", `你的动作已锁定。`, [seat], undefined, a);
  switch (a.type) {
    case "seerCheck":
      if (a.targetSeat !== null) {
        const faction =
          player(s, a.targetSeat!).role === "wolf" ? "wolf" : "good";
        s.abilities[seat].checks.push({ seat: a.targetSeat!, faction });
        event(
          s,
          "private",
          `查验${a.targetSeat}号：${faction === "wolf" ? "狼人" : "好人"}。`,
          [seat],
        );
      }
      break;
    case "witchUse":
      if (a.mode === "save") {
        s.abilities[seat].save = false;
        s.night.saved = true;
      }
      if (a.mode === "poison") {
        s.abilities[seat].poison = false;
        s.night.poison = a.targetSeat!;
      }
      break;
    case "hunterShoot":
      s.abilities[seat].shot = true;
      if (a.targetSeat !== null) {
        player(s, seat).revealedRole = "hunter";
        event(s, "skill", `${seat}号猎人开枪，带走${a.targetSeat}号。`);
        kill(s, new Map([[a.targetSeat!, ["shot"]]]));
      }
      break;
    case "badgeTransfer":
      s.sheriff = a.targetSeat ?? null;
      if (s.sheriff === null) s.badgeDestroyed = true;
      event(
        s,
        "skill",
        s.sheriff === null
          ? `${seat}号撕毁警徽。`
          : `${seat}号将警徽交给${s.sheriff}号。`,
      );
      break;
    case "chooseDirection":
      event(
        s,
        "host",
        `警长选择${a.direction === "clockwise" ? "顺" : "逆"}时针发言。`,
      );
      speech(s, "discussion", ordered(s, a.direction === "counterclockwise"));
      return s;
    case "speak":
      player(s, seat).gesture = a.gestureId || "neutral";
      event(
        s,
        "speech",
        a.text?.trim() || "本轮暂时没有补充观点。",
        "public",
        seat,
      );
      break;
    case "selfDestruct":
      player(s, seat).revealedRole = "wolf";
      event(s, "skill", `${seat}号狼人自爆，跳过本日剩余讨论与放逐。`);
      s.death = { hunters: [], words: [], continuation: "selfDestruct" };
      kill(s, new Map([[seat, ["selfDestruct"]]]));
      deathQueue(s);
      return s;
  }
  if (s.window.actors.every((i) => Object.hasOwn(s.window.answers, i)))
    advance(s);
  return s;
}
export function defaultAction(o: Observation): Action {
  const r = o.legalActions[0];
  if (!r) throw new Error("NOT_ELIGIBLE");
  switch (r.type) {
    case "speak":
      return {
        type: "speak",
        text: "本轮暂时没有补充观点。",
        gestureId: "neutral",
      };
    case "witchUse":
      return { type: "witchUse", mode: "none", targetSeat: null };
    case "sheriffJoin":
    case "sheriffWithdraw":
      return { type: r.type, value: false };
    case "chooseDirection":
      return { type: r.type, direction: "clockwise" };
    default:
      return { type: r.type, targetSeat: null };
  }
}
export function abortGame(original: GameState) {
  if (original.outcome) return original;
  const s = structuredClone(original);
  s.version++;
  end(s, "aborted", "玩家放弃本局");
  return s;
}
export function fullReview(s: GameState) {
  if (!s.outcome) throw new Error("GAME_NOT_ENDED");
  return {
    roles: s.players.map((p) => ({ seat: p.seat, name: p.name, role: p.role })),
    events: s.events
      .filter((e) => e.type !== "action")
      .map((e) => ({
        day: e.day,
        type: e.type,
        text: e.text,
        data: e.audience === "host" ? e.data : undefined,
      })),
    outcome: s.outcome,
  };
}
