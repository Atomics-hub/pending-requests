import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "pending-requests-package-"));
const packOutput = execFileSync(
  "npm",
  ["pack", "--json", "--pack-destination", temporary],
  {
    cwd: root,
    encoding: "utf8",
  },
);
const packed = JSON.parse(packOutput)[0];
assert.equal(packed.name, "pending-requests");
assert.equal(
  packed.files.some((file) => file.path.startsWith("src/")),
  false,
);
assert.equal(
  packed.files.some((file) => file.path.startsWith("test/")),
  false,
);
assert.equal(
  packed.files.some((file) => file.path === "dist/index.js"),
  true,
);
assert.equal(
  packed.files.some((file) => file.path === "dist/index.cjs"),
  true,
);
assert.equal(
  packed.files.some((file) => file.path === "dist/index.d.ts"),
  true,
);
assert.equal(
  packed.files.some((file) => file.path === "dist/index.d.cts"),
  true,
);
assert.ok(
  packed.size < 30_000,
  `tarball is unexpectedly large: ${packed.size}`,
);

const consumer = join(temporary, "consumer");
await writeFile(join(temporary, ".keep"), "");
await mkdir(consumer);
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
const tarball = join(temporary, packed.filename);
execFileSync(
  "npm",
  ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
  { cwd: consumer, stdio: "pipe" },
);

await writeFile(
  join(consumer, "esm.mjs"),
  `import { PendingRequests } from "pending-requests";
const r = new PendingRequests(); const p = r.register("id"); r.resolve("id", 42);
if (await p !== 42 || r.size !== 0) throw new Error("ESM smoke failed");`,
);
await writeFile(
  join(consumer, "cjs.cjs"),
  `const { PendingRequests } = require("pending-requests");
const r = new PendingRequests(); const p = r.register("id"); r.resolve("id", 42);
p.then(value => { if (value !== 42 || r.size !== 0) process.exitCode = 1; });`,
);
await writeFile(
  join(consumer, "types.ts"),
  `import { PendingRequests, PendingRequestTimeoutError } from "pending-requests";
const r = new PendingRequests<string, number>();
const p: Promise<number> = r.register("id"); r.resolve("id", 1);
void p; void PendingRequestTimeoutError;`,
);
await writeFile(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
    },
    include: ["types.ts"],
  }),
);

execFileSync("node", ["esm.mjs"], { cwd: consumer, stdio: "inherit" });
execFileSync("node", ["cjs.cjs"], { cwd: consumer, stdio: "inherit" });
execFileSync(
  process.execPath,
  [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
  {
    cwd: consumer,
    stdio: "inherit",
  },
);
const installedPackage = JSON.parse(
  await readFile(
    join(consumer, "node_modules/pending-requests/package.json"),
    "utf8",
  ),
);
assert.equal(installedPackage.dependencies, undefined);
assert.deepEqual(
  (await readdir(join(consumer, "node_modules/pending-requests"))).sort(),
  [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "dist",
    "package.json",
  ],
);
console.log(
  `Packed consumer smoke passed: ${packed.filename} (${packed.size} bytes)`,
);
