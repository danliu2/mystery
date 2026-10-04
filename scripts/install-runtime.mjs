import { createRequire } from "node:module";
import { readFile, readdir, mkdir, writeFile, rename } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const packagePath = require.resolve("electron/package.json");
const dir = dirname(packagePath);
const pkg = JSON.parse(await readFile(packagePath, "utf8"));
const executable =
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron";
let installed = false;
try {
  installed =
    existsSync(join(dir, "dist", executable)) &&
    (await readFile(join(dir, "dist/version"), "utf8"))
      .trim()
      .replace(/^v/, "") === pkg.version;
} catch {}
if (!installed && process.platform === "darwin") {
  const cache = join(homedir(), "Library/Caches/electron");
  const artifact = `electron-v${pkg.version}-darwin-${process.arch}.zip`;
  const checksums = JSON.parse(
    await readFile(join(dir, "checksums.json"), "utf8"),
  );
  let folders = [];
  try {
    folders = await readdir(cache);
  } catch {}
  for (const folder of folders) {
    const archive = join(cache, folder, artifact);
    if (!existsSync(archive)) continue;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest("hex") !== checksums[artifact]) continue;
    await mkdir(join(dir, "dist"), { recursive: true });
    execFileSync("/usr/bin/ditto", ["-x", "-k", archive, join(dir, "dist")]);
    await writeFile(join(dir, "path.txt"), executable);
    if (existsSync(join(dir, "dist/electron.d.ts")))
      await rename(join(dir, "dist/electron.d.ts"), join(dir, "electron.d.ts"));
    installed = true;
    console.log(`Electron ${pkg.version}: verified cached runtime installed.`);
    break;
  }
}
if (!installed) {
  const result = spawnSync(process.execPath, [join(dir, "install.js")], {
    stdio: "inherit",
    timeout: 180000,
  });
  if (result.status !== 0)
    throw new Error(
      "Electron runtime installation failed. Check the network or ELECTRON_MIRROR and run npm run setup-runtime again.",
    );
}
