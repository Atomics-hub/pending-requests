import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { performance } from "node:perf_hooks";
import { PendingRequests } from "../src/index.js";

const operationCount = Number.parseInt(
  process.env.PENDING_REQUESTS_STRESS ?? "1000000",
  10,
);
const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

const registry = new PendingRequests<number, number>();
const started = performance.now();
const batchSize = 10_000;
for (let offset = 0; offset < operationCount; offset += batchSize) {
  const count = Math.min(batchSize, operationCount - offset);
  const promises: Promise<number>[] = [];
  for (let index = 0; index < count; index += 1) {
    promises.push(registry.register(index));
    registry.resolve(index, index);
  }
  await Promise.all(promises);
  assert.equal(registry.size, 0);
}
const elapsed = performance.now() - started;

const shared = new PendingRequests<number, number>();
const controller = new AbortController();
const concurrent = Array.from({ length: 100_000 }, (_, id) =>
  shared
    .register(id, { signal: controller.signal })
    .catch((reason: unknown) => reason),
);
assert.equal(shared.size, 100_000);
assert.equal(getEventListeners(controller.signal, "abort").length, 1);
const abortReason = new Error("shared transport closed");
controller.abort(abortReason);
const results = await Promise.all(concurrent);
assert.equal(
  results.every((result) => result === abortReason),
  true,
);
assert.equal(shared.size, 0);
assert.equal(getEventListeners(controller.signal, "abort").length, 0);

await new Promise<void>((resolve) => setImmediate(resolve));
assert.deepEqual(unhandled, []);
console.log(
  JSON.stringify({
    operations: operationCount,
    operationsPerSecond: Math.round(operationCount / (elapsed / 1_000)),
    concurrentRequests: 100_000,
    remainingEntries: registry.size + shared.size,
    unhandledRejections: unhandled.length,
  }),
);
