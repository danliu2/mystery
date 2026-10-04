import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoster,
  selectFriends,
  updateRosterAfterMatch,
  restRoster,
} from "../src/agents/personas.js";
import { createGame } from "../src/domain/engine.js";
test("creator produces 20 unique stable adult friends with independent game identities", () => {
  const roster = createRoster(41);
  assert.equal(roster.people.length, 20);
  assert.equal(new Set(roster.people.map((p) => p.name)).size, 20);
  assert.ok(
    roster.people.every(
      (p) => p.age >= 20 && p.age <= 45 && p.energy <= 100 && !("role" in p),
    ),
  );
  assert.equal(selectFriends(roster, 13, 123).length, 13);
});
test("postgame experience is view limited and idempotent and absent friends recover", () => {
  const r = createRoster(41);
  const friends = selectFriends(r, 5, 3);
  const s = createGame({
    count: 6,
    seed: 33,
    friends: friends.map((p) => ({
      playerId: p.id,
      name: p.name,
      description: p.description,
    })),
  });
  s.outcome = { status: "good_win", reason: "test" };
  const next = updateRosterAfterMatch(r, s);
  const used = next.people.find((p) => p.id === friends[0].id)!;
  assert.equal(used.memories.length, 1);
  assert.ok(used.energy < r.people.find((p) => p.id === used.id)!.energy);
  assert.ok(!used.memories[0].reflection.includes("全知"));
  assert.deepEqual(updateRosterAfterMatch(next, s), next);
  assert.ok(
    next.people
      .filter((p) => !friends.some((f) => f.id === p.id))
      .every(
        (p) => p.energy >= r.people.find((old) => old.id === p.id)!.energy,
      ),
  );
});
test("rest is clamped and available once per completed match", () => {
  const r = createRoster(41);
  r.people[0].energy = 5;
  const rested = restRoster(r);
  assert.equal(rested.people[0].energy, 25);
  assert.deepEqual(restRoster(rested), rested);
});

test("friend names, gender, stature and visible descriptions remain consistent across seeds", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const people = createRoster(seed).people;
    assert.equal(people.filter((p) => p.gender === "女").length, 10);
    assert.equal(people.filter((p) => p.gender === "男").length, 10);
    const su = people.find((p) => p.name === "苏晚晴")!;
    assert.equal(su.gender, "女");
    assert.ok(su.height >= 158 && su.height <= 175);
    for (const p of people) {
      assert.ok(
        p.gender === "女"
          ? p.height >= 158 && p.height <= 175
          : p.height >= 168 && p.height <= 186,
      );
      assert.ok(p.description.includes(p.gender));
    }
  }
});

test("legacy stature is corrected without resetting friend IDs or memories", async () => {
  const module = (await import("../src/agents/personas.js")) as any;
  assert.equal(typeof module.normalizeRosterAppearance, "function");
  const old = createRoster(4);
  const su = old.people.find((p) => p.name === "苏晚晴")!;
  su.height = 191;
  su.description = "苏晚晴，身高191厘米，穿着米色衬衫。眉眼有自己的神采。";
  su.experienceCount = 12;
  su.summary = "我的旧经验";
  const updated = module.normalizeRosterAppearance(old);
  const fixed = updated.people.find((p: any) => p.id === su.id);
  assert.equal(fixed.gender, "女");
  assert.ok(fixed.height <= 175);
  assert.ok(!fixed.description.includes("191厘米"));
  assert.equal(fixed.experienceCount, 12);
  assert.equal(fixed.summary, "我的旧经验");
  assert.deepEqual(module.normalizeRosterAppearance(updated), updated);
});
