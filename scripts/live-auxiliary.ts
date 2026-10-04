import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/llm/config.js";
import { Gateway } from "../src/llm/gateway.js";
import { createRoster } from "../src/agents/personas.js";
const config = await loadConfig("api_key.env");
if (!config) throw new Error("CONFIG_MISSING");
const gateway = new Gateway(config);
const people = createRoster(149).people;
const generated = await gateway.createDescriptions(people);
const changed = generated.filter(
  (p, i) => p.description !== people[i].description,
);
assert.ok(
  changed.length > 0,
  "Creator did not accept any generated description",
);
await mkdir(".local-runs", { recursive: true });
await writeFile(
  `.local-runs/creator-${randomUUID()}.json`,
  JSON.stringify(generated, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    creatorRequested: 20,
    creatorAccepted: changed.length,
    usage: gateway.usage,
  }),
);
