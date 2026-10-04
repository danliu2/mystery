import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const data = await mkdtemp(join(tmpdir(), "mystery-smoke-"));
await mkdir(".superpowers/sdd/werewolf/screenshots", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MYSTERY_DATA_DIR: data, MYSTERY_CONFIG_DIR: data },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.getByRole("heading", { name: "入座，故事就要开始。" }).waitFor();
  await page.getByRole("button", { name: "开始游戏 →" }).waitFor();
  await page.screenshot({
    path: ".superpowers/sdd/werewolf/screenshots/lobby.png",
  });
  await page.getByLabel("桌上人数").selectOption("6");
  await page.getByLabel("你的身份").selectOption("villager");
  await page.getByRole("button", { name: "开始游戏 →" }).click();
  await page.getByLabel("阅读速度").selectOption("0");
  await page.getByRole("heading", { name: "今晚，你相信谁？" }).waitFor();
  await page.screenshot({
    path: ".superpowers/sdd/werewolf/screenshots/game.png",
  });
  let turns = 0;
  let state;
  const handled = new Set();
  for (let i = 0; i < 600; i++) {
    state = await page.evaluate(() => window.mystery.view());
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
    } else if (rule?.type === "exileVote") {
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
  await page.getByRole("button", { name: "查看全知复盘" }).click();
  await page.getByRole("dialog", { name: "全知复盘" }).waitFor();
  await page.screenshot({
    path: ".superpowers/sdd/werewolf/screenshots/review.png",
  });
  if (errors.length) throw new Error(`renderer errors: ${errors.join(";")}`);
  console.log(
    JSON.stringify({
      electron: await app.evaluate(({ app }) => app.getVersion()),
      outcome: state.observation.outcome,
      turns,
      rendererErrors: errors.length,
    }),
  );
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
