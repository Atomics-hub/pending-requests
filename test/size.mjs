import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

const limits = { "dist/index.js": 3_000, "dist/index.cjs": 3_000 };
for (const [file, limit] of Object.entries(limits)) {
  const source = await readFile(file);
  const gzip = gzipSync(source, { level: 9 });
  if (gzip.byteLength > limit) {
    throw new Error(
      `${file} is ${gzip.byteLength} bytes gzip; budget is ${limit}`,
    );
  }
  const text = source.toString("utf8");
  if (
    /from\s*["']node:|import\s*["']node:|require\(["'](?:node:|fs|events|timers)/.test(
      text,
    )
  ) {
    throw new Error(`${file} unexpectedly depends on a Node builtin`);
  }
  console.log(
    `${file}: ${source.byteLength} bytes raw, ${gzip.byteLength} bytes gzip`,
  );
}
