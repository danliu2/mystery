import type { GameState, LegalAction, Observation } from "./types.js";
import { PHASE_LABELS } from "./types.js";
import { digest } from "./random.js";
export function legalActions(s: GameState, seat: number): LegalAction[] {
  if (
    s.outcome ||
    !s.window.actors.includes(seat) ||
    Object.hasOwn(s.window.answers, seat)
  )
    return [];
  const living = s.players.filter((p) => p.alive);
  const others = living.filter((p) => p.seat !== seat).map((p) => p.seat);
  switch (s.phase) {
    case "wolfVote":
      return [{ type: "wolfVote", targets: s.night.alive, allowNull: true }];
    case "seerCheck":
      return [
        {
          type: "seerCheck",
          targets: s.night.alive.filter((i) => i !== seat),
          allowNull: true,
        },
      ];
    case "witchUse": {
      const potions = s.abilities[seat];
      const modes = ["none"];
      if (potions.save && s.night.knife !== null && s.night.knife !== seat)
        modes.push("save");
      if (potions.poison) modes.push("poison");
      return [
        {
          type: "witchUse",
          targets: s.night.alive.filter((i) => i !== seat),
          allowNull: true,
          modes,
        },
      ];
    }
    case "hunterShoot":
      return [{ type: "hunterShoot", targets: others, allowNull: true }];
    case "badgeTransfer":
      return [
        {
          type: "badgeTransfer",
          targets: living
            .filter((p) => p.seat !== seat && p.voteEligible)
            .map((p) => p.seat),
          allowNull: true,
        },
      ];
    case "sheriffJoin":
    case "sheriffWithdraw":
      return [{ type: s.phase }];
    case "sheriffVote":
    case "sheriffPKVote":
      return [{ type: "sheriffVote", targets: s.candidates, allowNull: true }];
    case "exileVote":
    case "pkVote":
      return [
        {
          type: "exileVote",
          targets: living
            .filter(
              (p) =>
                p.exileEligible &&
                p.seat !== seat &&
                (s.phase !== "pkVote" || s.pk.includes(p.seat)),
            )
            .map((p) => p.seat),
          allowNull: true,
        },
      ];
    case "direction":
      return [{ type: "chooseDirection" }];
    default: {
      const maxLength =
        s.phase === "discussion"
          ? s.players[seat - 1].actor === "human"
            ? 600
            : 400
          : s.phase === "sheriffSpeech"
            ? 280
            : 200;
      const actions: LegalAction[] = [{ type: "speak", maxLength }];
      if (s.phase === "discussion" && s.players[seat - 1].role === "wolf")
        actions.push({ type: "selfDestruct" });
      return actions;
    }
  }
}
export function observe(s: GameState, seat: number): Observation {
  const p = s.players[seat - 1];
  if (!p) throw new Error("INVALID_PRINCIPAL");
  const night = ["wolfVote", "seerCheck", "witchUse"].includes(s.phase);
  const myWindow = s.window.actors.includes(seat);
  const phase = night && !myWindow ? "night" : s.phase;
  // Nonactors get a generic public daytime wait across discussion, words and hidden skill windows.
  // Never publish a unique label that implies a hidden hunter eligibility check.
  const publicPhase = !myWindow && !night && !s.outcome ? "day" : phase;
  const o: Observation = {
    gameId: s.id,
    ownSeat: seat,
    day: s.day,
    phase: publicPhase,
    phaseLabel:
      publicPhase === "day"
        ? "白天 · 等待本阶段完成"
        : PHASE_LABELS[publicPhase] || "等待阶段完成",
    ownRole: p.role,
    practice: s.practice,
    windowId: myWindow ? s.window.id : null,
    viewRevision: "",
    players: s.players.map((q) => ({
      seat: q.seat,
      name: q.name,
      gender: q.gender,
      description: q.description,
      alive: q.alive,
      revealedRole: q.revealedRole,
      sheriff: s.sheriff === q.seat,
      gesture: q.gesture,
      voteEligible: q.voteEligible,
    })),
    events: s.events
      .filter(
        (e) =>
          e.audience === "public" ||
          (Array.isArray(e.audience) && e.audience.includes(seat)),
      )
      .map((e, i) => ({
        id: `v${i + 1}`,
        day: e.day,
        type: e.type,
        text: e.text,
        ...(e.seat ? { seat: e.seat } : {}),
        private: e.audience !== "public",
      })),
    ownFacts: {},
    legalActions: legalActions(s, seat),
    submitted: myWindow && Object.hasOwn(s.window.answers, seat),
    outcome: s.outcome,
  };
  if (p.role === "wolf")
    o.ownFacts.wolves = s.players
      .filter((q) => q.role === "wolf")
      .map((q) => q.seat);
  if (p.role === "seer") o.ownFacts.checks = s.abilities[seat].checks;
  if (p.role === "witch") {
    o.ownFacts.potions = {
      save: s.abilities[seat].save,
      poison: s.abilities[seat].poison,
    };
    if (s.phase === "witchUse" && myWindow && s.abilities[seat].save)
      o.ownFacts.knife = s.night.knife;
  }
  o.viewRevision = digest(JSON.stringify(o)).slice(0, 24);
  return structuredClone(o);
}

// Renderer-only projection. Agents always use observe(), even after elimination.
export function isSpectating(s: GameState, seat: number): boolean {
  const p = s.players[seat - 1];
  if (!p || p.actor !== "human") return false;
  if (s.outcome) return true;
  if (
    p.alive ||
    s.window.actors.includes(seat) ||
    s.death.hunters.includes(seat) ||
    s.sheriff === seat
  )
    return false;
  const pendingWords =
    s.death.words.includes(seat) &&
    (["hunterShoot", "badgeTransfer"].includes(s.phase) ||
      (s.day === 1 && s.phase.startsWith("sheriff")) ||
      (["lastWords", "exileLastWords"].includes(s.phase) &&
        s.queue.includes(seat)));
  return !pendingWords;
}
export function observeHuman(s: GameState, seat: number): Observation {
  const o = observe(s, seat);
  if (!isSpectating(s, seat)) return o;
  o.phase = s.phase;
  o.phaseLabel = PHASE_LABELS[s.phase];
  o.players.forEach((p, i) => {
    p.revealedRole = s.players[i].role;
  });
  o.events = s.events.map((e, i) => ({
    id: `v${i + 1}`,
    day: e.day,
    type: e.type,
    text: e.text,
    ...(e.seat ? { seat: e.seat } : {}),
    private: e.audience !== "public",
  }));
  o.legalActions = [];
  o.windowId = null;
  o.viewRevision = digest(JSON.stringify(o)).slice(0, 24);
  return o;
}
