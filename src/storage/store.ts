import {
  mkdir,
  open,
  rename,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "../domain/random.js";
import type { GameState } from "../domain/types.js";
import type { Roster } from "../agents/personas.js";

export async function atomicWrite(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const f = await open(temporary, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(data));
    await f.sync();
  } finally {
    await f.close();
  }
  try {
    await rename(temporary, path);
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}
const idCheck = (id: string) => {
  if (
    typeof id !== "string" ||
    !/^game-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      id,
    )
  )
    throw new Error("INVALID_ID");
};
function validState(s: unknown): s is GameState {
  const g = s as GameState;
  return (
    !!g &&
    g.schemaVersion === 1 &&
    typeof g.id === "string" &&
    Number.isInteger(g.version) &&
    g.version >= 0 &&
    Array.isArray(g.players) &&
    g.players.length >= 6 &&
    g.players.length <= 14 &&
    g.players.every(
      (p, i) => p.seat === i + 1 && typeof p.alive === "boolean",
    ) &&
    Array.isArray(g.events) &&
    !!g.window &&
    Array.isArray(g.window.actors) &&
    !!g.abilities &&
    !!g.preset
  );
}
export class Store {
  readonly warnings: string[] = [];
  constructor(readonly directory: string) {}
  private path(id: string) {
    idCheck(id);
    return join(this.directory, "games", id);
  }
  async commit(state: GameState) {
    const dir = this.path(state.id);
    if (!validState(state)) throw new Error("INVALID_STATE");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${String(state.version).padStart(8, "0")}.json`);
    const payload = JSON.stringify(state);
    const record = {
      schemaVersion: 1,
      version: state.version,
      prevVersion: state.version - 1,
      state,
      checksum: digest(payload),
    };
    try {
      const existing = JSON.parse(await readFile(file, "utf8"));
      if (existing.checksum === record.checksum) return;
      throw new Error("VERSION_CONFLICT");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    await atomicWrite(file, record);
    // Snapshots are advisory; a failed snapshot must not reject an already committed transaction.
    if (state.version % 20 === 0) {
      try {
        await atomicWrite(
          join(dir, `snapshot-${(state.version / 20) % 2}.json`),
          record,
        );
      } catch {
        this.warnings.push("快照写入失败，事务仍已保存。");
      }
    }
  }
  async load(id: string): Promise<GameState | null> {
    const dir = this.path(id);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    const transactions = files.filter((f) => /^\d{8}\.json$/.test(f)).sort();
    let last: GameState | null = null;
    let broken = false;
    for (const file of transactions) {
      const path = join(dir, file);
      if (!broken) {
        try {
          const record = JSON.parse(await readFile(path, "utf8"));
          if (
            !validState(record.state) ||
            record.state.id !== id ||
            record.version !== (last ? last.version + 1 : 0) ||
            record.prevVersion !== record.version - 1 ||
            record.state.version !== record.version ||
            record.checksum !== digest(JSON.stringify(record.state))
          )
            throw new Error("CORRUPT_TRANSACTION");
          last = record.state;
          continue;
        } catch {
          broken = true;
          this.warnings.push(`${id}末尾事务损坏，已恢复最后完整状态。`);
        }
      }
      await rename(path, `${path}.quarantine-${randomUUID()}`);
    }
    return last;
  }
  async list() {
    let ids: string[];
    try {
      ids = await readdir(join(this.directory, "games"));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    const entries = [];
    for (const id of ids.filter((id) =>
      /^game-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        id,
      ),
    )) {
      const s = await this.load(id);
      if (s)
        entries.push({
          id: s.id,
          day: s.day,
          count: s.players.length,
          status: s.outcome?.status || "playing",
          modified: (await stat(this.path(id))).mtimeMs,
        });
    }
    return entries.sort((a, b) => b.modified - a.modified);
  }
  async remove(id: string) {
    await rm(this.path(id), { recursive: true, force: true });
  }
  async loadRoster(): Promise<Roster | null> {
    try {
      const r = JSON.parse(
        await readFile(join(this.directory, "roster.json"), "utf8"),
      );
      if (
        r.schemaVersion !== 1 ||
        !Array.isArray(r.people) ||
        r.people.length !== 20 ||
        !Array.isArray(r.active) ||
        !Array.isArray(r.processedMatches) ||
        r.people.some(
          (p: any) =>
            typeof p.id !== "string" ||
            typeof p.name !== "string" ||
            !Array.isArray(p.memories),
        )
      )
        throw new Error("INVALID_ROSTER");
      return r;
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async saveRoster(roster: Roster) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicWrite(join(this.directory, "roster.json"), roster);
  }
  async backupRoster() {
    try {
      await rename(
        join(this.directory, "roster.json"),
        join(this.directory, `roster-backup-${randomUUID()}.json`),
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
