import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(
  new URL("./fixtures/runtime-smoke.mjs", import.meta.url),
);
const runtimes = [
  { name: "node", command: "node", args: [fixture] },
  { name: "bun", command: "bun", args: [fixture] },
  { name: "deno", command: "deno", args: ["run", "--allow-read", fixture] },
];

for (const runtime of runtimes) {
  const version = spawnSync(runtime.command, ["--version"], {
    encoding: "utf8",
  });
  if (version.error?.code === "ENOENT") {
    if (process.env.CI) throw new Error(`${runtime.name} is required in CI`);
    console.warn(`Skipping ${runtime.name}: executable not found`);
    continue;
  }
  if (version.status !== 0)
    throw new Error(`${runtime.name} --version failed: ${version.stderr}`);

  const result = spawnSync(runtime.command, runtime.args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${runtime.name} smoke test failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  process.stdout.write(result.stdout);
}
