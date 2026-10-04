import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "../domain/types.js";
export class Prompts {
  constructor(
    private readonly directory = join(
      process.cwd(),
      "resources/prompts/werewolf",
    ),
  ) {}
  read(name: string) {
    if (!/^[a-z]+$/.test(name)) throw new Error("INVALID_PROMPT_NAME");
    const text = readFileSync(
      join(this.directory, `${name}.txt`),
      "utf8",
    ).trim();
    if (!text || text.length > 32000)
      throw new Error("INVALID_PROMPT_RESOURCE");
    return text;
  }
  player(role: Role, values: Record<string, string>) {
    const fields = {
      ...values,
      roleStrategy: this.read(role),
      rules: this.read("rules"),
    };
    return this.read("player").replace(/{{([a-zA-Z]+)}}/g, (_, key) => {
      if (!(key in fields)) throw new Error("UNKNOWN_PROMPT_PLACEHOLDER");
      return fields[key as keyof typeof fields];
    });
  }
}
