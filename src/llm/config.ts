import { readFile } from "node:fs/promises";
export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  jsonMode: boolean;
  contextTokens: number;
  thinking?: boolean;
  reasoningEffort?: "low" | "high" | "max";
  maxOutputTokens?: number;
  maxRequests: number;
  maxTokens: number;
}
export function validateEndpoint(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error("INVALID_ENDPOINT");
  }
  if (u.username || u.password || u.search || u.hash)
    throw new Error("INVALID_ENDPOINT");
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw new Error("INSECURE_ENDPOINT");
  return value.replace(/\/+$/, "");
}
export function parseConfig(text: string): ProviderConfig {
  const pairs: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    pairs[m[1]] = value;
  }
  const baseURL =
    pairs.LLM_BASE_URL ||
    pairs.OPENAI_BASE_URL ||
    pairs.DEEPSEEK_BASE_URL ||
    pairs.API_URL;
  const apiKey =
    pairs.LLM_API_KEY ||
    pairs.OPENAI_API_KEY ||
    pairs.DEEPSEEK_API_KEY ||
    pairs.API_KEY ||
    "";
  const model = pairs.LLM_MODEL || pairs.OPENAI_MODEL || pairs.MODEL;
  if (!baseURL || !model) throw new Error("CONFIG_MISSING");
  if (/[\r\n]/.test(apiKey) || model.length > 100)
    throw new Error("INVALID_CONFIG");
  const contextTokens = Number(pairs.LLM_CONTEXT_TOKENS || 32000);
  if (
    !Number.isInteger(contextTokens) ||
    contextTokens < 2048 ||
    contextTokens > 1000000
  )
    throw new Error("INVALID_CONTEXT_LIMIT");
  if (
    pairs.LLM_REASONING_EFFORT &&
    !["low", "high", "max"].includes(pairs.LLM_REASONING_EFFORT)
  )
    throw new Error("INVALID_REASONING_EFFORT");
  return {
    baseURL: validateEndpoint(baseURL),
    apiKey,
    model,
    jsonMode: pairs.LLM_JSON_MODE !== "false",
    contextTokens,
    ...(pairs.LLM_THINKING ? { thinking: pairs.LLM_THINKING === "true" } : {}),
    ...(pairs.LLM_REASONING_EFFORT
      ? {
          reasoningEffort: pairs.LLM_REASONING_EFFORT as "low" | "high" | "max",
        }
      : {}),
    maxRequests: 300,
    maxTokens: 200000,
  };
}
export async function loadConfig(path: string) {
  try {
    return parseConfig(await readFile(path, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export function publicConfig(c: ProviderConfig | null) {
  return c
    ? {
        baseURL: c.baseURL,
        model: c.model,
        jsonMode: c.jsonMode,
        contextTokens: c.contextTokens,
        keyConfigured: !!c.apiKey,
      }
    : null;
}
