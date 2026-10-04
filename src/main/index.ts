import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Store } from "../storage/store.js";
import { Session } from "./session.js";
import {
  loadConfig,
  publicConfig,
  validateEndpoint,
  type ProviderConfig,
} from "../llm/config.js";
import { Gateway } from "../llm/gateway.js";
import { IPC_METHODS, validateIPC } from "./ipc.js";
import { PRESETS, ROLES, validatePresets } from "../domain/resources.js";
const root = join(__dirname, "..");
const configPath = join(process.env.MYSTERY_CONFIG_DIR || root, "api_key.env");
let window: BrowserWindow;
let session: Session;
let config: ProviderConfig | null = null;
let gateway: Gateway | null = null;
let configError = "";
let closing = false;
const errorLabels: Record<string, string> = {
  ROSTER_MISMATCH: "该存档来自另一组朋友，请确认恢复开局人物库后再载入。",
  CONFIG_MISSING: "请先配置入口目录的 api_key.env，或选择离线演示。",
  AUTH_FAILED: "认证失败，请检查密钥文件。",
  NO_BALANCE: "服务余额不足。",
  INVALID_IPC: "操作参数不正确。",
  MATCH_IN_PROGRESS: "请先结束或放弃当前对局。",
  GAME_NOT_ENDED: "整局结束后才能查看全知复盘。",
  PRESENTATION_PENDING: "请先读完当前记录。",
  PAUSED: "游戏已暂停。",
  STORAGE_FAILED: "存档失败，请检查磁盘。",
  INVALID_TARGET: "该目标不符合角色规则。",
  WINDOW_CLOSED: "阶段已经变化，请重试。",
  NOT_ELIGIBLE: "当前不能执行该动作。",
  INVALID_PAYLOAD: "动作不符合当前规则。",
  BUDGET_EXCEEDED: "本局模型预算已用完。",
};
async function reloadConfig() {
  try {
    config = await loadConfig(configPath);
    gateway = config
      ? new Gateway(config, {
          promptDirectory: join(root, "resources/prompts/werewolf"),
        })
      : null;
    configError = "";
  } catch {
    config = null;
    gateway = null;
    configError = "模型配置不正确，请检查 api_key.env（未展示文件内容）。";
  }
  if (session) session.setGateway(gateway);
}
async function reloadResources() {
  const list = JSON.parse(
    await readFile(join(root, "resources/games/werewolf/presets.json"), "utf8"),
  );
  validatePresets(list);
  PRESETS.splice(0, PRESETS.length, ...list);
  const roles = JSON.parse(
    await readFile(join(root, "resources/games/werewolf/roles.json"), "utf8"),
  );
  for (const [key, value] of Object.entries(ROLES)) {
    const r = roles[key];
    if (
      !r ||
      typeof r.name !== "string" ||
      r.name.length > 20 ||
      r.faction !== value.faction ||
      r.group !== value.group
    )
      throw new Error("INVALID_ROLES");
    value.name = r.name;
  }
}
const settings = () => ({
  provider: publicConfig(config),
  configPath,
  error: configError,
});
async function route(method: string, arg: any): Promise<unknown> {
  switch (method) {
    case "bootstrap":
      return {
        lobby: session.lobby(),
        view: session.view(),
        settings: settings(),
        saves: await session.store.list(),
      };
    case "lobby":
      return session.lobby();
    case "view":
      return session.view();
    case "start":
      await reloadResources();
      return session.start(arg);
    case "act":
      return session.act(arg);
    case "ack":
      return session.ack(arg);
    case "pause":
      session.pause();
      return session.view();
    case "resume":
      await session.resume();
      return session.view();
    case "abandon":
      await session.abandon();
      return session.view();
    case "review":
      return session.review();
    case "rest":
      return session.rest();
    case "rosterReset":
      return session.initializeFriends(arg.useModel);
    case "saves":
      return session.store.list();
    case "load":
      return typeof arg === "string"
        ? session.load(arg)
        : session.load(arg.id, arg.restoreFriends);
    case "deleteSave":
      await session.removeSave(arg);
      return session.store.list();
    case "settings":
      return settings();
    case "reloadProvider":
      await reloadConfig();
      return settings();
    case "budget":
      session.increaseBudget();
      return session.view();
    case "testProvider":
      if (!gateway) throw new Error("CONFIG_MISSING");
      await gateway.testConnection();
      return { ok: true };
    case "updateSettings": {
      if (session.lobby().activeMatch) throw new Error("MATCH_IN_PROGRESS");
      const baseURL = validateEndpoint(arg.baseURL);
      if (/[\r\n]/.test(arg.model) || !arg.model.trim())
        throw new Error("INVALID_CONFIG");
      const text = `LLM_BASE_URL=${baseURL}\nLLM_MODEL=${arg.model.trim()}\nLLM_API_KEY=${config?.apiKey || ""}\nLLM_JSON_MODE=${arg.jsonMode}\nLLM_CONTEXT_TOKENS=${arg.contextTokens}\n${config?.thinking !== undefined ? `LLM_THINKING=${config.thinking}\n` : ""}${config?.reasoningEffort ? `LLM_REASONING_EFFORT=${config.reasoningEffort}\n` : ""}`;
      await writeFile(configPath, text, { mode: 0o600 });
      await reloadConfig();
      return settings();
    }
    case "manual":
      return readFile(join(__dirname, "player-guide.md"), "utf8");
    default:
      throw new Error("INVALID_IPC");
  }
}
if (process.env.MYSTERY_DATA_DIR)
  app.setPath("userData", process.env.MYSTERY_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      await reloadConfig();
      const store = new Store(app.getPath("userData"));
      session = new Session(store, gateway);
      await session.initialize();
      await reloadResources();
      window = new BrowserWindow({
        width: 1260,
        height: 820,
        minWidth: 1000,
        minHeight: 700,
        title: "谜夜 · 狼人杀",
        backgroundColor: "#0c1118",
        show: false,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          devTools: true,
        },
      });
      const rendererURL = pathToFileURL(join(__dirname, "index.html")).href;
      for (const method of IPC_METHODS)
        ipcMain.handle(`mystery:${method}`, async (event, arg) => {
          try {
            if (
              event.sender !== window.webContents ||
              event.senderFrame !== window.webContents.mainFrame ||
              event.senderFrame?.url !== rendererURL
            )
              throw new Error("INVALID_SENDER");
            validateIPC(method, arg);
            return { ok: true, value: await route(method, arg) };
          } catch (e) {
            const code = e instanceof Error ? e.message : "FAILED";
            return {
              ok: false,
              error:
                errorLabels[code] ||
                `操作未完成（${/^[A-Z_]+$/.test(code) ? code : "FAILED"}）。`,
            };
          }
        });
      session.on("change", (view) => {
        if (!window.isDestroyed())
          window.webContents.send("mystery:viewChanged", view);
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (url !== rendererURL) event.preventDefault();
      });
      window.once("ready-to-show", () => window.show());
      await window.loadFile(join(__dirname, "index.html"));
      window.on("close", (event) => {
        if (closing) return;
        event.preventDefault();
        session.pause();
        void session.idle().then(() => {
          closing = true;
          window.close();
        });
      });
    })
    .catch(() => {
      void dialog
        .showMessageBox({
          type: "error",
          title: "谜夜启动失败",
          message:
            "无法读取资源或存档，请检查文件和磁盘权限。不会打印配置内容。",
        })
        .then(() => app.quit());
    });
  app.on("window-all-closed", () => app.quit());
}
