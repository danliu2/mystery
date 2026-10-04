import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";

import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const resumeDirectory = process.argv[3]?.startsWith("--")
  ? undefined
  : process.argv[3];
const allowFallback = process.argv.includes("--allow-fallback");
const data = resumeDirectory
  ? resolve(resumeDirectory)
  : resolve(".local-runs", `llm-${randomUUID()}`);
await mkdir(data, { recursive: true });
const count = process.argv[2] || "6";
await mkdir(".superpowers/sdd/werewolf/screenshots", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    MYSTERY_DATA_DIR: data,
    MYSTERY_CONFIG_DIR: process.cwd(),
  },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  if (process.argv.includes("--hide"))
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.hide()),
    );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.getByRole("heading", { name: "入座，故事就要开始。" }).waitFor();
  await page.getByRole("button", { name: "开始游戏 →" }).waitFor();
  await page.screenshot({
    path: ".superpowers/sdd/werewolf/screenshots/lobby.png",
  });
  if (resumeDirectory) {
    await page.evaluate(async () => {
      const saves = await window.mystery.saves();
      if (!saves.length) throw new Error("NO_SAVED_GAME");
      await window.mystery.load(saves[0].id);
      const state = await window.mystery.view();
      if (!state.observation.outcome) {
        await window.mystery.budget();
        await window.mystery.resume();
      }
    });
  } else {
    await page.getByLabel("桌上人数").selectOption(count);
    await page.getByLabel("你的身份").selectOption("villager");
    await page.getByRole("button", { name: "开始游戏 →" }).click();
    if (Number(count) >= 10)
      await page.evaluate(async () => {
        await window.mystery.budget();
        await window.mystery.budget();
      });
  }
  if ((await page.getByLabel("阅读速度").inputValue()) !== "0")
    throw new Error("not instant by default");
  await page.getByRole("heading", { name: "今晚，你相信谁？" }).waitFor();
  await page.screenshot({
    path: ".superpowers/sdd/werewolf/screenshots/game.png",
  });
  let turns = 0;
  let state;
  const handled = new Set();
  let phase = "";
  for (let i = 0; i < 12000; i++) {
    state = await page.evaluate(() => window.mystery.view());
    if (state.observation.outcome) break;
    if (state.paused) throw new Error(`model paused: ${state.notice}`);
    const current = `day${state.observation.day}:${state.observation.phase}:${state.observation.events.length}`;
    if (current !== phase) {
      console.log(current);
      phase = current;
    }
    if (state.observation.outcome) break;
    const rule = state.observation.legalActions[0];
    if (rule && handled.has(state.observation.windowId)) {
      await page.waitForTimeout(100);
      continue;
    }
    if (rule) handled.add(state.observation.windowId);
    if (rule?.type === "speak") {
      await page
        .locator("textarea")
        .fill("我会继续关注前后矛盾的发言，再结合投票来判断。");
      await page.getByRole("button", { name: "提交发言 →" }).click();
      turns++;
    } else if (
      rule?.type === "sheriffJoin" ||
      rule?.type === "sheriffWithdraw"
    ) {
      await page
        .getByRole("button", {
          name: rule.type === "sheriffJoin" ? "不上警" : "退水",
          exact: true,
        })
        .click();
      turns++;
    } else if (rule?.type === "chooseDirection") {
      await page.getByRole("button", { name: "顺时针", exact: true }).click();
      turns++;
    } else if (rule?.targets) {
      const target = rule.targets[0];
      if (target) {
        await page
          .locator(".targets button")
          .filter({ hasText: new RegExp(`^${target}`) })
          .first()
          .click();
      }
      await page.getByRole("button", { name: "确认动作 →" }).click();
      turns++;
    } else await page.waitForTimeout(100);
  }
  if (!state?.observation.outcome) throw new Error("game did not terminate");
  const review = await page.evaluate(() => window.mystery.review());
  if (
    !review.decisionAudits.length ||
    review.decisionAudits.some(
      (a) =>
        (a.source !== "model" && !allowFallback) ||
        !a.decisionReason ||
        (a.source === "model" && !a.attempts.some((r) => r.reasoningContent)),
    )
  )
    throw new Error("incomplete model audit");
  const id = state.observation.gameId;
  const oldView = await page.evaluate(() => window.mystery.view());
  if (
    JSON.stringify(oldView).includes("reasoningContent") ||
    JSON.stringify(oldView).includes("decisionReason")
  )
    throw new Error("private audit leaked to player view");
  await page.evaluate(async (id) => {
    await window.mystery.pause();
    await window.mystery.load(id);
  }, id);
  const restored = await page.evaluate(() => window.mystery.review());
  if (
    JSON.stringify(restored.decisionAudits) !==
    JSON.stringify(review.decisionAudits)
  )
    throw new Error("audit restore mismatch");
  await page.getByRole("button", { name: "查看全知复盘" }).click();
  await page.getByRole("dialog", { name: "全知复盘" }).waitFor();
  await page
    .getByRole("heading", { name: "Agent 私人思考与决策 · 上帝视角" })
    .waitFor();
  await page
    .getByLabel("复盘 Agent")
    .selectOption(String(review.decisionAudits[0].seat));
  const decision = page.locator("details.event").first();
  await decision.locator("summary").first().click();
  await decision.locator("details").first().locator("summary").first().click();
  await page.screenshot({ path: `${data}/review.png` });
  if (errors.length) throw new Error(`renderer errors: ${errors.join(";")}`);
  console.log(
    JSON.stringify({
      appVersion: await app.evaluate(({ app }) => app.getVersion()),
      mode: state.mode,
      count: Number(count),
      gameId: id,
      dataDirectory: data,
      acceptedAIActions: review.decisionAudits.length,
      modelDecisions: review.decisionAudits.filter((a) => a.source === "model")
        .length,
      thinkingResponses: review.decisionAudits
        .flatMap((a) => a.attempts)
        .filter((r) => r.reasoningContent).length,
      fallbackDecisions: review.decisionAudits.filter(
        (a) => a.source !== "model",
      ).length,
      roles: [
        ...new Set(
          review.decisionAudits.map(
            (a) => review.roles.find((r) => r.seat === a.seat)?.role,
          ),
        ),
      ],
      outcome: state.observation.outcome,
      turns,
      rendererErrors: errors.length,
    }),
  );
} finally {
  await app.close();
}
