import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Observation, Action, Role } from "../domain/types.js";
import type { SessionView } from "../main/session.js";
import "./style.css";
type Pane = "table" | "friends" | "saves" | "settings" | "manual";
declare global {
  interface Window {
    mystery: Record<string, (...args: any[]) => any>;
  }
}
const api = window.mystery;
const roleNames: Record<string, string> = {
  wolf: "狼人",
  villager: "平民",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  idiot: "白痴",
};
const gestureNames: Record<string, string> = {
  neutral: "安静地坐着",
  thoughtful: "若有所思",
  smile: "露出微笑",
  frown: "微微皱眉",
  calm: "神情平静",
};
const eventNames: Record<string, string> = {
  host: "主持人",
  speech: "发言",
  private: "私人信息",
  action: "动作已锁定",
  result: "结果",
  votes: "公开票型",
  skill: "公开技能",
};
function App() {
  const [lobby, setLobby] = useState<any>(null),
    [view, setView] = useState<SessionView | null>(null),
    [settings, setSettings] = useState<any>(null),
    [saves, setSaves] = useState<any[]>([]),
    [pane, setPane] = useState<Pane>("table");
  const [count, setCount] = useState(12),
    [humanRole, setHumanRole] = useState(""),
    [humanName, setHumanName] = useState("我"),
    [mode, setMode] = useState<"model" | "demo">("demo"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [person, setPerson] = useState<any>(null),
    [manual, setManual] = useState(""),
    [review, setReview] = useState<any>(null),
    [speed, setSpeed] = useState(6),
    [partial, setPartial] = useState({ id: "", text: "" }),
    [draft, setDraft] = useState(""),
    [target, setTarget] = useState<number | null>(null),
    [witchMode, setWitchMode] = useState("none"),
    [autoScroll, setAutoScroll] = useState(true);
  const [baseURL, setBaseURL] = useState("http://localhost:11434/v1"),
    [model, setModel] = useState(""),
    [contextTokens, setContextTokens] = useState(32000),
    [jsonMode, setJsonMode] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const task = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const refreshLobby = async () => {
    setLobby(await api.lobby());
    setSaves(await api.saves());
  };
  useEffect(() => {
    void task(async () => {
      const data = await api.bootstrap();
      setLobby(data.lobby);
      setView(data.view);
      setSettings(data.settings);
      setSaves(data.saves);
      if (data.settings.provider) {
        const p = data.settings.provider;
        setMode("model");
        setBaseURL(p.baseURL);
        setModel(p.model);
        setJsonMode(p.jsonMode);
        setContextTokens(p.contextTokens);
      }
    });
    return api.onView((v: SessionView) => setView(v));
  }, []);
  const next = view?.observation.events[view.displayed];
  useEffect(() => {
    if (!view || view.paused || !next || pane !== "table") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const text = next.text;
    setPartial({ id: next.id, text: speed === 0 ? text : "" });
    const ack = (id: string) => {
      void api.ack(id).catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    };
    if (speed === 0) {
      ack(`v${view.presentationTarget}`);
    } else {
      const chars = [...text];
      let i = 0;
      timer = setInterval(() => {
        if (cancelled) return;
        i++;
        setPartial({ id: next.id, text: chars.slice(0, i).join("") });
        if (i >= chars.length) {
          clearInterval(timer);
          ack(next.id);
        }
      }, 1000 / speed);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [view?.observation.gameId, next?.id, view?.paused, speed, pane]);
  useEffect(() => {
    if (autoScroll && pane === "table")
      bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [view?.displayed, partial.text, autoScroll, pane]);
  useEffect(() => {
    setTarget(null);
    setWitchMode("none");
  }, [view?.observation.windowId]);
  const preset = lobby?.presets.find((p: any) => p.count === count);
  const o = view?.observation;
  const actionRule = o?.legalActions[0];
  const active = o && !o.outcome;
  async function start() {
    await task(async () => {
      const current = await api.view();
      if (current && !current.observation.outcome) {
        if (!confirm("新游戏会放弃当前对局，确定吗？")) return;
        await api.abandon();
      }
      const v = await api.start({
        count,
        humanName,
        mode,
        ...(humanRole ? { humanRole } : {}),
      });
      setView(v);
      setPane("table");
      setReview(null);
      setDraft("");
      await refreshLobby();
    });
  }
  async function send(action: Action) {
    if (!o?.windowId) return;
    await task(async () => {
      const v = await api.act({
        commandId: crypto.randomUUID(),
        windowId: o.windowId,
        action,
      });
      setView(v);
      if (action.type === "speak") setDraft("");
    });
  }
  async function navigate(p: Pane) {
    setPane(p);
    setError("");
    if (p === "friends") await task(refreshLobby);
    if (p === "saves") await task(async () => setSaves(await api.saves()));
    if (p === "settings")
      await task(async () => setSettings(await api.settings()));
    if (p === "manual") await task(async () => setManual(await api.manual()));
  }
  const shown = o?.events.slice(0, view!.displayed + (next ? 1 : 0)) || [];
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand-symbol">☾</div>
        <div className="brand-name">
          谜夜<span>MYSTERY</span>
        </div>
        <nav>
          {(
            [
              ["table", "◉", "对局"],
              ["friends", "♧", "朋友"],
              ["saves", "▤", "存档"],
              ["settings", "⚙", "设置"],
              ["manual", "?", "手册"],
            ] as const
          ).map(([p, icon, label]) => (
            <button
              key={p}
              className={pane === p ? "nav active" : "nav"}
              onClick={() => void navigate(p)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          一张牌，一段故事。<small>文字桌游 · v0.1</small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">SOCIAL DEDUCTION</span>
            <h1>
              {pane === "table"
                ? o
                  ? "今晚，你相信谁？"
                  : "入座，故事就要开始。"
                : pane === "friends"
                  ? "熟悉的朋友，不同的秘密。"
                  : pane === "saves"
                    ? "把这一夜留住。"
                    : pane === "settings"
                      ? "准备好下一场对话。"
                      : "桌边的规则。"}
            </h1>
          </div>
          <div className="top-actions">
            <span
              className={
                "service-dot " +
                ((view?.mode || mode) === "model" ? "live" : "")
              }
            >
              {(view?.mode || mode) === "model" ? "共享模型服务" : "离线演示"}
            </span>
            {o && (
              <button
                className="quiet"
                onClick={() =>
                  void task(async () => {
                    if (view!.paused) {
                      setView(await api.resume());
                    } else setView(await api.pause());
                  })
                }
              >
                {view!.paused ? "▷ 继续" : "Ⅱ 暂停"}
              </button>
            )}
            <button
              className="quiet"
              onClick={() =>
                void task(async () => {
                  await api.pause();
                  setView(null);
                  setReview(null);
                  setPane("table");
                  await refreshLobby();
                })
              }
            >
              ＋ 大厅
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {pane === "table" && !o && (
          <div className="lobby">
            <div className="hero">
              <div className="moon-art">
                ☾<span>✦</span>
              </div>
              <span className="eyebrow">THE NIGHT IS YOUNG</span>
              <h2>
                每个人都有故事。
                <br />
                也有人，藏着秘密。
              </h2>
              <p>
                和一群熟悉的 AI 朋友围桌而坐。听他们说话，找到矛盾，
                <br />
                守住你的身份，在天亮之前做出自己的选择。
              </p>
              <div className="hero-tags">
                <span>单人参与</span>
                <span>持续人格</span>
                <span>严格角色视野</span>
              </div>
            </div>
            <section className="setup-card">
              <div className="section-title">
                <h3>准备一局</h3>
                <span>经典文字狼人杀</span>
              </div>
              <label>
                桌上人数
                <select
                  value={count}
                  onChange={(e) => {
                    setCount(Number(e.target.value));
                    setHumanRole("");
                  }}
                >
                  {Array.from({ length: 9 }, (_, i) => i + 6).map((n) => (
                    <option key={n} value={n}>
                      {n} 人 {n === 12 ? "· 预女猎白" : n === 6 ? "· 入门" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="role-chips">
                {preset &&
                  Object.entries(preset.roles)
                    .filter(([, n]) => Number(n) > 0)
                    .map(([r, n]) => (
                      <span key={r} className={r === "wolf" ? "wolf" : ""}>
                        {roleNames[r]} × {String(n)}
                      </span>
                    ))}
              </div>
              <div className="form-row">
                <label>
                  你的名字
                  <input
                    maxLength={20}
                    value={humanName}
                    onChange={(e) => setHumanName(e.target.value)}
                  />
                </label>
                <label>
                  你的身份
                  <select
                    value={humanRole}
                    onChange={(e) => setHumanRole(e.target.value)}
                  >
                    <option value="">随机身份</option>
                    {preset &&
                      Object.entries(preset.roles)
                        .filter(([, n]) => Number(n) > 0)
                        .map(([r]) => (
                          <option key={r} value={r}>
                            {roleNames[r]} · 练习
                          </option>
                        ))}
                  </select>
                </label>
              </div>
              <label>
                朋友的决策方式
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                >
                  <option value="demo">离线演示 · 不调用模型</option>
                  <option value="model" disabled={!lobby?.modelAvailable}>
                    AI 模型 ·{" "}
                    {lobby?.modelAvailable ? "已配置" : "请先配置服务"}
                  </option>
                </select>
              </label>
              <div className="rule-note">
                {preset?.sheriff ? "有警长" : "无警长"} ·{" "}
                {preset?.winMode === "city" ? "狼人屠城" : "狼人屠边"}
                <br />
                女巫不可自救 · 狼人无私聊 · 死亡技能先结算
                <br />非 12 人配置为实验预设，30 日未分胜负判和局。
              </div>
              <button
                className="primary full"
                disabled={busy || !lobby}
                onClick={() => void start()}
              >
                {busy ? "正在准备…" : "开始游戏 →"}
              </button>
              <p className="small-note">
                目前只有文字。身份随机分配，外貌和神情不能证明阵营。
              </p>
              {lobby?.activeMatch && (
                <button
                  className="quiet full"
                  onClick={() =>
                    void task(async () => setView(await api.view()))
                  }
                >
                  返回进行中的对局
                </button>
              )}
            </section>
          </div>
        )}
        {pane === "table" && o && (
          <div className="game-grid">
            <section className="table-panel">
              <div className="phasebar">
                <div>
                  <span className="phase-day">
                    DAY {String(o.day).padStart(2, "0")}
                  </span>
                  <h2>{o.phaseLabel}</h2>
                </div>
                <div className="identity">
                  <span>我的身份</span>
                  <strong className={o.ownRole === "wolf" ? "wolf-text" : ""}>
                    {roleNames[o.ownRole]}
                  </strong>
                  {o.practice && <small>练习局</small>}
                </div>
              </div>
              <div className="facts-strip">
                {o.ownFacts.wolves && (
                  <span>
                    狼同伴：
                    {o.ownFacts.wolves.filter((i) => i !== 1).join("、")}号
                  </span>
                )}
                {o.ownFacts.potions && (
                  <span>
                    解药 {o.ownFacts.potions.save ? "●" : "○"}　毒药{" "}
                    {o.ownFacts.potions.poison ? "●" : "○"}
                    {o.ownFacts.knife !== undefined &&
                      `　当夜刀口：${o.ownFacts.knife === null ? "无" : o.ownFacts.knife + "号"}`}
                  </span>
                )}
                {o.ownFacts.checks?.length ? (
                  <span>
                    查验：
                    {o.ownFacts.checks
                      .map(
                        (c) =>
                          `${c.seat}号 ${c.faction === "wolf" ? "狼人" : "好人"}`,
                      )
                      .join(" / ")}
                  </span>
                ) : null}
                <label className="speed-control">
                  阅读速度
                  <select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    <option value={3}>慢速</option>
                    <option value={6}>标准</option>
                    <option value={12}>快速</option>
                    <option value={0}>立即显示</option>
                  </select>
                </label>
              </div>
              {view!.notice && (
                <div className="notice">
                  {view!.notice}
                  {view!.notice.includes("BUDGET") && (
                    <button
                      onClick={() =>
                        void task(async () => {
                          await api.budget();
                          setView(await api.resume());
                        })
                      }
                    >
                      增加预算并继续
                    </button>
                  )}
                </div>
              )}
              <div
                className="history"
                role="log"
                aria-label="本人可见的游戏历史"
              >
                {shown.map((e) => (
                  <article
                    key={e.id}
                    className={
                      "message " + e.type + (e.private ? " is-private" : "")
                    }
                  >
                    <div className="message-icon">
                      {e.type === "speech"
                        ? o.players
                            .find((p) => p.seat === e.seat)
                            ?.name.slice(-1)
                        : e.private
                          ? "◇"
                          : e.type === "host"
                            ? "☾"
                            : "·"}
                    </div>
                    <div>
                      <div className="message-meta">
                        <strong>
                          {e.seat
                            ? `${e.seat}号 · ${o.players[e.seat - 1].name}`
                            : eventNames[e.type] || "记录"}
                        </strong>
                        <span>
                          第{e.day}日 {e.private ? "· 仅你可见" : ""}
                        </span>
                      </div>
                      <p>
                        {next?.id === e.id && speed !== 0
                          ? partial.id === e.id
                            ? partial.text
                            : ""
                          : e.text}
                        {next?.id === e.id && speed !== 0 && (
                          <span className="typing-cursor">▌</span>
                        )}
                      </p>
                    </div>
                  </article>
                ))}
                <div ref={bottom} />
              </div>
              <div className="reading-tools">
                <label>
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />{" "}
                  自动跟随
                </label>
                {next && !view!.paused && (
                  <button
                    className="quiet"
                    onClick={() =>
                      void task(async () =>
                        setView(await api.ack(`v${view!.presentationTarget}`)),
                      )
                    }
                  >
                    读完了 · 显示全部 ↓
                  </button>
                )}
                <span>
                  {view!.mode === "model"
                    ? !view!.usageVisible
                      ? "模型用量在终局后显示"
                      : `${view!.usage.requests} 次请求 · ${view!.usage.estimated ? "约 " : ""}${view!.usage.tokens.toLocaleString()} tokens`
                    : "离线演示 · 无模型请求"}
                </span>
              </div>
              <div className="action-panel">
                {o.outcome ? (
                  <div className="end-card">
                    <span className="eyebrow">THE STORY CONTINUES</span>
                    <h3>
                      {o.outcome.status === "good_win"
                        ? "好人阵营胜利"
                        : o.outcome.status === "wolf_win"
                          ? "狼人阵营胜利"
                          : o.outcome.status === "draw"
                            ? "本局和局"
                            : "本局已放弃"}
                    </h3>
                    <p>{o.outcome.reason}</p>
                    {view!.finishing ? (
                      <p>朋友正在整理自己的经历…</p>
                    ) : (
                      <>
                        <button
                          className="primary"
                          onClick={() =>
                            void task(async () => setReview(await api.review()))
                          }
                        >
                          查看全知复盘
                        </button>
                        <button
                          className="quiet"
                          onClick={() => {
                            setView(null);
                            void refreshLobby();
                          }}
                        >
                          下一局
                        </button>
                      </>
                    )}
                  </div>
                ) : actionRule ? (
                  <>
                    <div className="action-heading">
                      <strong>
                        {actionRule.type === "speak"
                          ? "轮到你发言了"
                          : actionRule.type === "witchUse"
                            ? "选择用药方式"
                            : "请选择你的动作"}
                      </strong>
                      <span>确认后锁定</span>
                    </div>
                    {actionRule.type === "speak" ? (
                      <>
                        <textarea
                          value={draft}
                          maxLength={actionRule.maxLength}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="写下你的分析、怀疑或辩解。发言不会执行技能或投票。"
                        />
                        <div className="action-buttons">
                          <span>
                            {[...draft].length}/{actionRule.maxLength}
                          </span>
                          <button
                            className="quiet"
                            disabled={busy}
                            onClick={() =>
                              void send({ type: "speak", text: "" })
                            }
                          >
                            跳过
                          </button>
                          {o.legalActions.some(
                            (a) => a.type === "selfDestruct",
                          ) && (
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm(
                                    "自爆会公开你的狼人身份并出局，跳过今天剩余讨论和放逐。确定吗？",
                                  )
                                )
                                  void send({ type: "selfDestruct" });
                              }}
                            >
                              狼人自爆
                            </button>
                          )}
                          <button
                            className="primary"
                            disabled={busy || !draft.trim()}
                            onClick={() =>
                              void send({ type: "speak", text: draft })
                            }
                          >
                            提交发言 →
                          </button>
                        </div>
                      </>
                    ) : ["sheriffJoin", "sheriffWithdraw"].includes(
                        actionRule.type,
                      ) ? (
                      <div className="action-buttons">
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void send({ type: actionRule.type, value: false })
                          }
                        >
                          {actionRule.type === "sheriffJoin"
                            ? "不上警"
                            : "继续竞选"}
                        </button>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void send({ type: actionRule.type, value: true })
                          }
                        >
                          {actionRule.type === "sheriffJoin"
                            ? "参加竞选"
                            : "退水"}
                        </button>
                      </div>
                    ) : actionRule.type === "chooseDirection" ? (
                      <div className="action-buttons">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              type: "chooseDirection",
                              direction: "clockwise",
                            })
                          }
                        >
                          顺时针
                        </button>
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              type: "chooseDirection",
                              direction: "counterclockwise",
                            })
                          }
                        >
                          逆时针
                        </button>
                      </div>
                    ) : (
                      <>
                        {actionRule.type === "witchUse" && (
                          <div className="mode-buttons">
                            {actionRule.modes?.map((m) => (
                              <button
                                key={m}
                                className={witchMode === m ? "selected" : ""}
                                onClick={() => {
                                  setWitchMode(m);
                                  setTarget(
                                    m === "save"
                                      ? (o.ownFacts.knife ?? null)
                                      : null,
                                  );
                                }}
                              >
                                {m === "none"
                                  ? "不用药"
                                  : m === "save"
                                    ? "使用解药"
                                    : "使用毒药"}
                              </button>
                            ))}
                          </div>
                        )}
                        {(actionRule.type !== "witchUse" ||
                          witchMode === "poison") && (
                          <div className="targets">
                            {actionRule.targets?.map((seat) => (
                              <button
                                key={seat}
                                className={target === seat ? "selected" : ""}
                                onClick={() => setTarget(seat)}
                              >
                                {seat}
                                <span>{o.players[seat - 1].name}</span>
                              </button>
                            ))}
                            {actionRule.allowNull &&
                              actionRule.type !== "witchUse" && (
                                <button
                                  className={target === null ? "selected" : ""}
                                  onClick={() => setTarget(null)}
                                >
                                  {actionRule.type === "wolfVote"
                                    ? "空刀"
                                    : actionRule.type === "hunterShoot"
                                      ? "不开枪"
                                      : actionRule.type === "badgeTransfer"
                                        ? "撕徽"
                                        : "弃权"}
                                </button>
                              )}
                          </div>
                        )}
                        <div className="action-buttons">
                          <span>
                            {actionRule.type === "witchUse" &&
                            witchMode === "none"
                              ? "本夜不用药"
                              : target === null
                                ? "不指定目标"
                                : `已选择 ${target}号 · ${o.players[target - 1].name}`}
                          </span>
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              (actionRule.type === "witchUse" &&
                                witchMode === "poison" &&
                                target === null)
                            }
                            onClick={() => {
                              const irreversible = [
                                "witchUse",
                                "hunterShoot",
                                "badgeTransfer",
                              ].includes(actionRule.type);
                              if (
                                irreversible &&
                                !confirm(
                                  `确认${actionRule.type === "witchUse" ? (witchMode === "none" ? "不用药" : witchMode === "save" ? "使用解药" : "使用毒药") : "执行此技能"}${target !== null ? "，目标 " + target + "号" : ""}？`,
                                )
                              )
                                return;
                              void send(
                                actionRule.type === "witchUse"
                                  ? {
                                      type: "witchUse",
                                      mode: witchMode,
                                      targetSeat:
                                        witchMode === "none" ? null : target,
                                    }
                                  : {
                                      type: actionRule.type,
                                      targetSeat: target,
                                    },
                              );
                            }}
                          >
                            确认动作 →
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="waiting">
                    <span className="pulse-dot" />
                    {view!.paused
                      ? "对局已暂停"
                      : next
                        ? "请先读完当前记录"
                        : o.submitted
                          ? "你的动作已经锁定，等待本阶段完成"
                          : "等待主持人推进，留意桌上的发言。"}
                  </div>
                )}
              </div>
            </section>
            <aside className="participants">
              <div className="section-title">
                <h3>围桌而坐</h3>
                <span>
                  {o.players.filter((p) => p.alive).length}/{o.players.length}{" "}
                  存活
                </span>
              </div>
              {o.players.map((p) => (
                <button
                  key={p.seat}
                  className={
                    "player-card " +
                    (!p.alive ? "dead " : "") +
                    (p.seat === 1 ? "self" : "")
                  }
                  onClick={() =>
                    setPerson({
                      name: p.name,
                      description: p.description,
                      gesture: p.gesture,
                      alive: p.alive,
                    })
                  }
                >
                  <div
                    className={
                      "avatar " +
                      (p.seat % 3 === 0
                        ? "sage"
                        : p.seat % 3 === 1
                          ? "gold"
                          : "blue")
                    }
                  >
                    {p.name.slice(-1)}
                  </div>
                  <div>
                    <strong>
                      {p.name}
                      {p.seat === 1 && <small> 我</small>}
                    </strong>
                    <span>
                      {p.seat}号 ·{" "}
                      {p.alive ? gestureNames[p.gesture] : "已出局"}
                    </span>
                    {p.revealedRole && (
                      <em>{roleNames[p.revealedRole]} · 已公开</em>
                    )}
                  </div>
                  {p.sheriff && <span className="badge">♛</span>}
                </button>
              ))}
              <p className="small-note">
                表情可能是刻意的表演。
                <br />
                请以发言和票型作判断。
              </p>
              <button
                className="quiet full"
                disabled={busy}
                onClick={() => {
                  if (confirm("确定放弃本局吗？不会计入胜败和经验。"))
                    void task(async () => setView(await api.abandon()));
                }}
              >
                放弃本局
              </button>
            </aside>
          </div>
        )}
        {pane === "friends" && (
          <section className="content-page">
            <div className="section-title">
              <div>
                <h2>我们的桌游朋友</h2>
                <p>人格与外貌持续保留，游戏身份每局重新分配。</p>
              </div>
              <div>
                <button
                  className="quiet"
                  disabled={busy || !!active || !lobby?.restAvailable}
                  onClick={() =>
                    void task(async () => setLobby(await api.rest()))
                  }
                >
                  休息一下
                </button>
                <button
                  className="primary"
                  disabled={busy || !!active}
                  onClick={() => {
                    if (
                      confirm(
                        "重新创建整组20位朋友，会替换当前人格和记忆（旧库将备份）。确定吗？",
                      )
                    )
                      void task(async () =>
                        setLobby(
                          await api.rosterReset({ useModel: mode === "model" }),
                        ),
                      );
                  }}
                >
                  初始化朋友
                </button>
              </div>
            </div>
            <div className="friend-grid">
              {lobby?.people.map((p: any) => (
                <button
                  className="friend-card"
                  key={p.id}
                  onClick={() => setPerson(p)}
                >
                  <div className="avatar">{p.name.slice(-1)}</div>
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <span>一起经历了 {p.games} 局</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {pane === "saves" && (
          <section className="content-page">
            <h2>保存的夜晚</h2>
            <p>对局自动保存。恢复后先暂停；已经锁定的动作不会丢失。</p>
            {saves.length ? (
              saves.map((s) => (
                <div className="save-row" key={s.id}>
                  <div>
                    <strong>
                      {s.count}人局 · 第{s.day}日
                    </strong>
                    <span>
                      {s.status === "playing"
                        ? "进行中"
                        : s.status === "aborted"
                          ? "已放弃"
                          : "已结束"}{" "}
                      · {new Date(s.modified).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !!active}
                    onClick={() =>
                      void task(async () => {
                        if (
                          !confirm(
                            "恢复对局。如果朋友库已更换，会恢复该局开局人物库并备份当前朋友。继续吗？",
                          )
                        )
                          return;
                        setView(
                          await api.load({ id: s.id, restoreFriends: true }),
                        );
                        setPane("table");
                      })
                    }
                  >
                    恢复
                  </button>
                  <button
                    className="quiet"
                    disabled={busy || lobby?.activeMatch === s.id}
                    onClick={() => {
                      if (confirm("确定删除这个对局存档吗？"))
                        void task(async () =>
                          setSaves(await api.deleteSave(s.id)),
                        );
                    }}
                  >
                    删除
                  </button>
                </div>
              ))
            ) : (
              <div className="empty">还没有存档。入座开始第一局吧。</div>
            )}
          </section>
        )}
        {pane === "settings" && (
          <section className="content-page settings-page">
            <h2>共享模型服务</h2>
            <p>
              每位朋友只会把自己合法看见的游戏信息发送给这个服务。密钥只保存在主进程，聊天中不要输入密钥。
            </p>
            <div className="settings-box">
              <label>
                OpenAI 格式 Base URL
                <input
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                />
              </label>
              <label>
                模型名称
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="填写供应商提供的可用模型名"
                />
              </label>
              <label>
                上下文容量
                <input
                  type="number"
                  min={2048}
                  max={1000000}
                  value={contextTokens}
                  onChange={(e) => setContextTokens(Number(e.target.value))}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={jsonMode}
                  onChange={(e) => setJsonMode(e.target.checked)}
                />{" "}
                使用 json_object（服务需支持）
              </label>
              <div className="rule-note">
                密钥：
                {settings?.provider?.keyConfigured
                  ? "已配置（不显示明文）"
                  : "尚未配置 / 本地服务可不需要"}
                <br />
                配置文件：<code>{settings?.configPath}</code>
                <br />
                请复制 api_key.env.example 为 api_key.env，再在本地编辑密钥。
              </div>
              {settings?.error && (
                <p className="error-text">{settings.error}</p>
              )}
              <div className="action-buttons">
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      setSettings(await api.reloadProvider());
                      await refreshLobby();
                    })
                  }
                >
                  重新读取配置
                </button>
                <button
                  className="quiet"
                  disabled={busy || !lobby?.modelAvailable}
                  onClick={() => {
                    if (
                      confirm(
                        "测试会发送一个简短请求，可能产生服务费用。继续吗？",
                      )
                    )
                      void task(async () => {
                        await api.testProvider();
                        setError("连接测试成功。");
                      });
                  }}
                >
                  测试连接
                </button>
                <button
                  className="primary"
                  disabled={busy || !!active || !model.trim()}
                  onClick={() =>
                    void task(async () => {
                      setSettings(
                        await api.updateSettings({
                          baseURL,
                          model,
                          jsonMode,
                          contextTokens,
                        }),
                      );
                      await refreshLobby();
                    })
                  }
                >
                  保存设置
                </button>
              </div>
            </div>
            <h3>阅读与声音</h3>
            <p>
              首版仅支持文字。游戏内可调整阅读速度或直接显示完整段落，语音接口已预留。
            </p>
          </section>
        )}
        {pane === "manual" && (
          <section className="content-page manual-page">
            <pre>{manual || "正在读取手册…"}</pre>
          </section>
        )}
      </main>
      {person && (
        <div className="modal-backdrop" onClick={() => setPerson(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="朋友介绍"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" onClick={() => setPerson(null)}>
              ×
            </button>
            <div className="avatar large">{person.name.slice(-1)}</div>
            <span className="eyebrow">A FRIEND AT THE TABLE</span>
            <h2>{person.name}</h2>
            <p>{person.description}</p>
            {person.gesture && (
              <p>最近的公开表现：{gestureNames[person.gesture]}</p>
            )}
            <div className="rule-note">
              外貌与神情不提供身份证明，也可能是刻意的表演。
            </div>
          </section>
        </div>
      )}
      {review && (
        <div className="modal-backdrop" onClick={() => setReview(null)}>
          <section
            className="modal review-modal"
            role="dialog"
            aria-label="全知复盘"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" onClick={() => setReview(null)}>
              ×
            </button>
            <span className="eyebrow">AFTER THE FINAL CURTAIN</span>
            <h2>全知事实复盘</h2>
            <p>整局已结束。以下真相不会自动成为 AI 朋友的跨局经验。</p>
            <div className="role-chips">
              {review.roles.map((p: any) => (
                <span key={p.seat} className={p.role === "wolf" ? "wolf" : ""}>
                  {p.seat}号 {p.name} · {roleNames[p.role]}
                </span>
              ))}
            </div>
            <div className="review-events">
              {review.events.map((e: any, i: number) => (
                <div key={i}>
                  <small>
                    第{e.day}日 · {eventNames[e.type] || "事实"}
                  </small>
                  <p>{e.text}</p>
                  {e.data && <pre>{JSON.stringify(e.data, null, 2)}</pre>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
