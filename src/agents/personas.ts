import type { GameState } from "../domain/types.js";
import { digest, random, shuffle } from "../domain/random.js";
import { observe } from "../domain/visibility.js";
import { roleName } from "../domain/resources.js";
export interface Memory {
  gameId: string;
  role: string;
  outcome: string;
  reflection: string;
  facts: string[];
}
export interface Persona {
  id: string;
  name: string;
  gender: string;
  age: number;
  height: number;
  weight: number;
  appearance: number;
  energy: number;
  irritability: number;
  traits: Record<string, number>;
  description: string;
  style: string;
  catchphrases: string[];
  clothes: string;
  memories: Memory[];
  summary: string;
  experienceCount: number;
}
export interface Roster {
  schemaVersion: 1;
  people: Persona[];
  active: string[];
  processedMatches: string[];
  restAvailable: boolean;
}
const names = [
  "林知远",
  "陈暮川",
  "许庭安",
  "周砚清",
  "江星河",
  "陆景行",
  "程亦舟",
  "沈怀瑾",
  "苏晚晴",
  "顾清禾",
  "叶初夏",
  "林予棠",
  "宋念慈",
  "温书宁",
  "唐映雪",
  "许青岚",
  "季予白",
  "沈星澄",
  "夏言",
  "安知",
];
const outfits = ["深蓝针织衫", "米色衬衫", "墨绿外套", "灰色开衫", "白色T恤"];
const traits = [
  "analysis",
  "skill",
  "risk",
  "expression",
  "suspicion",
  "stability",
  "performance",
  "humor",
  "memory",
];
const styles = [
  "语气平稳，喜欢逐条比较发言中的矛盾。",
  "表达直接，倾向先提出自己的判断再解释理由。",
  "善于倾听，用温和的追问检验他人的说法。",
  "偶尔带些幽默，但关键时刻会认真整理票型。",
];
export function createRoster(seed: number): Roster {
  const rng = { people: seed || 1 };
  const values = Object.fromEntries(
    traits.map((t) => [
      t,
      shuffle(
        Array.from(
          { length: 20 },
          (_, i) =>
            Math.floor(i / 4) * 20 + Math.floor(random(rng, "people") * 20),
        ),
        rng,
        "people",
      ),
    ]),
  );
  const people = names.map((name, i): Persona => {
    const height = 150 + Math.floor(random(rng, "people") * 46);
    const bmi = 18 + random(rng, "people") * 10;
    const weight = Math.max(
      45,
      Math.min(100, Math.round(bmi * (height / 100) ** 2)),
    );
    const clothes = outfits[Math.floor(random(rng, "people") * outfits.length)];
    const gender = i < 8 ? "男" : i < 16 ? "女" : "中性";
    const age = 20 + Math.floor(random(rng, "people") * 26);
    return {
      id: `p-${digest(`${seed}:${i}`).slice(0, 12)}`,
      name,
      gender,
      age,
      height,
      weight,
      appearance:
        Math.floor(i / 4) * 20 + Math.floor(random(rng, "people") * 20),
      energy: 80 + Math.floor(random(rng, "people") * 21),
      irritability: 0,
      traits: Object.fromEntries(traits.map((t) => [t, values[t][i]])),
      description: `${name}，${age}岁，身高${height}厘米，穿着${clothes}。眉眼有自己的神采，落座时轻轻整理袖口，专注地望向桌面。`,
      style: styles[i % styles.length],
      catchphrases: ["先听完整轮，再做判断。", "这条逻辑还需要一个解释。"],
      clothes,
      memories: [],
      summary: "",
      experienceCount: 0,
    };
  });
  return {
    schemaVersion: 1,
    people,
    active: [],
    processedMatches: [],
    restAvailable: true,
  };
}
export function selectFriends(
  roster: Roster,
  count: number,
  seed: number,
): Persona[] {
  if (!Number.isInteger(count) || count < 5 || count > 13)
    throw new Error("INVALID_COUNT");
  const rng = { roster: seed || 1 };
  let selected = roster.active
    .map((id) => roster.people.find((p) => p.id === id))
    .filter((p): p is Persona => !!p);
  if (selected.length > count)
    selected = shuffle(selected, rng, "roster").slice(0, count);
  let candidates = shuffle(
    roster.people.filter((p) => !selected.some((q) => q.id === p.id)),
    rng,
    "roster",
  );
  if (selected.length === count && random(rng, "roster") < 0.1) {
    const replacements = random(rng, "roster") < 0.8 ? 1 : 2;
    selected = shuffle(selected, rng, "roster").slice(replacements);
  }
  selected.push(...candidates.slice(0, count - selected.length));
  return selected;
}
export function publicDescription(p: Persona) {
  return `${p.description}${p.energy < 30 ? " 连续几局之后，神情略显疲惫。" : p.energy < 60 ? " 眼角透出一点倦意。" : ""}`;
}
export function updateRosterAfterMatch(roster: Roster, s: GameState): Roster {
  if (
    !s.outcome ||
    s.outcome.status === "aborted" ||
    roster.processedMatches.includes(s.id)
  )
    return roster;
  const next = structuredClone(roster);
  const rng = { dynamics: s.seed || 1 };
  next.processedMatches.push(s.id);
  next.restAvailable = true;
  for (const p of next.people) {
    const seat = s.players.find((q) => q.playerId === p.id)?.seat;
    if (seat) {
      const view = observe(s, seat);
      p.energy = Math.max(
        0,
        Math.min(
          100,
          p.energy -
            (6 + Math.floor(random(rng, "dynamics") * 7)) +
            Math.floor(random(rng, "dynamics") * 5),
        ),
      );
      p.irritability = Math.max(
        0,
        Math.min(
          100,
          p.irritability +
            2 +
            Math.floor(random(rng, "dynamics") * 5) -
            Math.floor(p.traits.stability / 25),
        ),
      );
      const facts = view.events
        .filter((e) => e.type !== "action")
        .map((e) => `${e.day}日 ${e.text}`)
        .slice(-12);
      p.memories.push({
        gameId: s.id,
        role: view.ownRole,
        outcome: s.outcome.status,
        reflection: `这一局我作为${roleName(view.ownRole)}参加，${s.outcome.reason}。我会在下次更认真地比较发言和投票，不把自己的猜测当成事实。`,
        facts,
      });
      p.experienceCount++;
      if (p.memories.length > 20) {
        const removed = p.memories.splice(0, p.memories.length - 20);
        p.summary = (
          p.summary +
          "\n" +
          removed.map((m) => m.reflection).join("\n")
        ).slice(-800);
      }
      if (random(rng, "dynamics") < 0.1) {
        p.clothes =
          outfits[Math.floor(random(rng, "dynamics") * outfits.length)];
        p.description = p.description.replace(
          /穿着[^。]+。/,
          `穿着${p.clothes}。`,
        );
      }
    } else {
      p.energy = Math.min(100, p.energy + 8);
      p.irritability = Math.max(0, p.irritability - 5);
    }
  }
  return next;
}
export function restRoster(roster: Roster) {
  if (!roster.restAvailable) return roster;
  const next = structuredClone(roster);
  next.restAvailable = false;
  for (const p of next.people) {
    p.energy = Math.min(100, p.energy + 20);
    p.irritability = Math.max(0, p.irritability - 10);
  }
  return next;
}
