# Werewolf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. User authorized local Git initialization and actual development on 2026-10-04; execute inline in this session.

**Goal:** 交付可启动、可完整游玩的单人文字狼人杀桌面版本。
**Architecture:** 确定性Host及逐座位投影运行在Electron主进程。独立AI通过共享OpenAI网关决策，事务存储在userData中，React仅接收真人视图。
**Tech Stack:** Node.js >=22.18、TypeScript、Electron、React、esbuild、Node test runner、tsx。
**Spec:** doc/README.md 及 doc/01_rules.md 至 doc/07_sources_decisions.md。

## Global Constraints

- secret目录、api_key.env及所有实际凭据不进入Git，不复制到模型prompt。
- 6–14人固定配置；12人4狼4民预女猎白；女巫不可自救、每夜单药。
- 狼人无私聊、静默聚合；死亡技能先于终局；第30日仍未结束判和局。
- Renderer关闭Node集成、隔离context、启用沙箱；仅真人视图可通过IPC。
- 不实现语音，保留播放/ASR/TTS契约；发布前不自动付费请求。

## Review Focus

1. 死亡后的真人及猎人窗口必须保留合法动作，不能获得全知复盘。
2. 密封票提交不得使其他人的窗口失效或公开进度。
3. 末尾事务损坏、磁盘失败和暂停后迟到响应不能丢失或重复动作。
4. API空JSON、认证失败、重定向和提示注入不能绕过权限或泄漏Key。
5. 首日竞选、遗言、自爆、平票返回路径不能导致重复讨论或跳过结算。

### Task 1: Rule engine and visibility

**Files:** src/domain/{types,random,engine,visibility}.ts; resources/games/werewolf/{presets,roles}.json; tests/engine.test.ts; package.json; tsconfig.json.
**Interfaces:** produces createGame(setup):GameState, submit(state,seat,command):GameState, observe(state,seat):Observation, defaultAction(observation):Action.
- [x] Write failing tests: presets sum, sealed votes, self-save rejection, poison hunter, final hunter shot, idiot restrictions, PK, sheriff and self-destruct.
- [x] Run `npm test -- tests/engine.test.ts`; expected missing engine, then feature assertions fail against initial skeleton.
- [x] Implement immutable transitions and private event projection, opaque window revisions; no network imports in domain.
- [x] Run `npm test`; expected all rule assertions pass; run scripted games across all presets without deadlock.
- [x] Commit verified domain and resources.

### Task 2: Durable storage and personas

**Files:** src/storage/store.ts; src/agents/personas.ts; tests/storage.test.ts; tests/personas.test.ts.
**Interfaces:** consumes GameState; produces Store.commit/load/list/remove, createRoster(seed), selectFriends, updateRosterAfterMatch.
- [x] Write failing tests for transaction recovery/corruption, locked secret votes after restore, unique20personas, fatigue/rest/rotation, idempotent experience.
- [x] Run targeted tests; expected missing modules/features.
- [x] Implement flushed atomic transaction files, snapshots, safe filenames, validated restore, roster backup and view-limited memory.
- [x] Run `npm test`; expected full suite green.
- [x] Commit verified storage/personas.

### Task 3: Model gateway and session

**Files:** src/llm/{config,gateway}.ts; src/agents/player.ts; src/main/session.ts; tests/{gateway,session}.test.ts.
**Interfaces:** consumes Observation and Store; produces loadConfig, Gateway.decide/createPeople/reflect, Session.start/act/view/pause/resume/review.
- [x] Write failing tests using a real local HTTP fixture for JSON repair, 401 pause, retry limits, redirection, prompt/key separation and cancellation; session tests for persistence and role binding.
- [x] Run targeted tests; expected missing features.
- [x] Implement credential-only HTTP headers, model capability validation, budgets, bounded retries, individual prompts, serialized session mutation, independent AI scheduling and presentation acknowledgments.
- [x] Run `npm test`; expected full suite green.
- [x] Commit verified gateway and session.

### Task 4: Electron desktop and text presentation

**Files:** src/main/index.ts; src/preload/index.cjs; src/renderer/{App.tsx,style.css,index.html}; src/presentation/types.ts; scripts/build.mjs; mystery.sh; mystery.command; api_key.env.example.
**Interfaces:** consumes Session; exposes narrow IPC methods and public observations; renders only projected data, private identity and legal actions.
- [x] Write failing renderer/session contract tests for read acknowledgment, dead-player view, review gate, malformed IPC commands and text handling.
- [x] Run tests; expected unavailable behavior.
- [x] Implement lobby/settings/persona detail/game/history/action panels/review; playback, pause, initialization and restart; safe sender validation and CSP; startup checks with quoted paths.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`; expected green. Launch real Electron and exercise UI with local mock service or offline fallback.
- [x] Commit verified desktop.

### Task 5: Final integration, review and documentation

**Files:** tests/integration.test.ts; scripts/simulate.ts; README.md; doc/09_development_status.md.
**Interfaces:** all prior modules; no new hidden-state renderer endpoints.
- [x] Add integration assertions for seeded replay, complete games, postgame updates, budgets and no secret tracking.
- [x] Run all tests, typecheck, build and simulation; inspect real Electron screenshot and action flow.
- [x] Review changed code, fix important issues through regression tests; update documentation with actual limitations and commands.
- [x] Commit and report local branch, tests, startup path and unverified live service/packaging limits.
