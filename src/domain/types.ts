import type { Roster } from "../agents/personas.js";
export type Role = "wolf" | "villager" | "seer" | "witch" | "hunter" | "idiot";
export type Phase =
  | "wolfVote"
  | "seerCheck"
  | "witchUse"
  | "hunterShoot"
  | "badgeTransfer"
  | "sheriffJoin"
  | "sheriffSpeech"
  | "sheriffWithdraw"
  | "sheriffVote"
  | "sheriffPKSpeech"
  | "sheriffPKVote"
  | "lastWords"
  | "direction"
  | "discussion"
  | "exileVote"
  | "pkSpeech"
  | "pkVote"
  | "exileLastWords"
  | "ended";
export type Action = {
  type: string;
  targetSeat?: number | null;
  mode?: string;
  value?: boolean;
  direction?: string;
  text?: string;
  gestureId?: string;
};
export interface Command {
  commandId: string;
  windowId: string;
  action: Action;
}
export interface Player {
  seat: number;
  actor: "human" | "ai";
  playerId: string | null;
  name: string;
  gender?: string | null;
  description: string;
  role: Role;
  alive: boolean;
  voteEligible: boolean;
  exileEligible: boolean;
  revealedRole: Role | null;
  gesture: string;
}
export interface Preset {
  count: number;
  roles: Record<Role, number>;
  sheriff: boolean;
  winMode: "city" | "edge";
  version: number;
  maxDays: number;
}
export interface GameEvent {
  day: number;
  type: string;
  text: string;
  seat?: number;
  audience: "public" | "host" | number[];
  data?: unknown;
}
export interface Window {
  id: string;
  actors: number[];
  answers: Record<string, Action>;
}
export interface GameState {
  schemaVersion: 1;
  id: string;
  seed: number;
  rng: Record<string, number>;
  windowCount: number;
  version: number;
  day: number;
  phase: Phase;
  preset: Preset;
  players: Player[];
  abilities: Record<
    number,
    {
      save: boolean;
      poison: boolean;
      shot: boolean;
      checks: { seat: number; faction: string }[];
    }
  >;
  window: Window;
  queue: number[];
  events: GameEvent[];
  commands: Record<string, { seat: number; fingerprint: string }>;
  sheriff: number | null;
  badgeDestroyed: boolean;
  candidates: number[];
  originalCandidates: number[];
  electors: number[];
  pk: number[];
  night: {
    alive: number[];
    knife: number | null;
    saved: boolean;
    poison: number | null;
  };
  death: {
    hunters: number[];
    words: number[];
    continuation: "dawn" | "exile" | "selfDestruct";
  };
  outcome: {
    status: "good_win" | "wolf_win" | "draw" | "aborted";
    reason: string;
  } | null;
  practice: boolean;
  decisionAudits?: DecisionAudit[];
  runtime?: {
    mode: "model" | "demo";
    rosterSnapshot?: Roster;
    usage: { requests: number; tokens: number; estimated: boolean };
    limits: { maxRequests: number; maxTokens: number };
  };
}
export interface LegalAction {
  type: string;
  targets?: number[];
  allowNull?: boolean;
  modes?: string[];
  maxLength?: number;
}
export interface Observation {
  gameId: string;
  ownSeat: number;
  day: number;
  phase: string;
  phaseLabel: string;
  ownRole: Role;
  practice: boolean;
  windowId: string | null;
  viewRevision: string;
  players: {
    seat: number;
    name: string;
    gender?: string | null;
    description: string;
    alive: boolean;
    revealedRole: Role | null;
    sheriff: boolean;
    gesture: string;
    voteEligible: boolean;
  }[];
  events: {
    id: string;
    day: number;
    type: string;
    text: string;
    seat?: number;
    private: boolean;
  }[];
  ownFacts: {
    wolves?: number[];
    checks?: { seat: number; faction: string }[];
    potions?: { save: boolean; poison: boolean };
    knife?: number | null;
  };
  legalActions: LegalAction[];
  submitted: boolean;
  outcome: GameState["outcome"];
}
export const GESTURES = [
  "neutral",
  "thoughtful",
  "smile",
  "frown",
  "calm",
] as const;
export const PHASE_LABELS: Record<string, string> = {
  night: "夜晚 · 请闭眼",
  wolfVote: "狼人选择目标",
  seerCheck: "预言家查验",
  witchUse: "女巫用药",
  hunterShoot: "猎人开枪",
  badgeTransfer: "警徽处置",
  sheriffJoin: "警长报名",
  sheriffSpeech: "警长竞选发言",
  sheriffWithdraw: "选择退水",
  sheriffVote: "警长投票",
  sheriffPKSpeech: "警长PK发言",
  sheriffPKVote: "警长PK投票",
  lastWords: "首夜遗言",
  direction: "选择发言方向",
  discussion: "白天讨论",
  exileVote: "放逐投票",
  pkSpeech: "放逐PK发言",
  pkVote: "放逐PK投票",
  exileLastWords: "放逐遗言",
  ended: "本局结束",
};

export interface DecisionAttempt {
  promptHash: string;
  responseId: string | null;
  reasoningContent: string | null;
  content: string;
  finishReason: string | null;
  receivedAt: string;
}
export interface DecisionAudit {
  seat: number;
  playerId: string;
  name: string;
  day: number;
  phase: string;
  windowId: string;
  source: "model" | "fallback";
  action: Action;
  model: string;
  promptHash: string;
  decisionReason: string;
  attempts: DecisionAttempt[];
  error?: string;
}
