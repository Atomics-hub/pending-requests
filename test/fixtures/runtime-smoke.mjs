import {
  DuplicatePendingRequestError,
  PendingRequests,
  PendingRequestTimeoutError,
} from "../../dist/index.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const outcome = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (value) => ({ ok: false, value }),
  );

const orphans = [];
const registry = new PendingRequests({
  onOrphan: (event) => orphans.push(event),
});
const sync = registry.request("sync", () => registry.resolve("sync", 42));
assert((await sync) === 42, "synchronous response");

const controller = new AbortController();
const reason = new Error("abort");
const aborted = outcome(
  registry.register("abort", { signal: controller.signal }),
);
controller.abort(reason);
assert((await aborted).value === reason, "abort reason identity");

const timed = await outcome(registry.register("timeout", { timeout: 0 }));
assert(timed.value instanceof PendingRequestTimeoutError, "timeout class");

const first = registry.register("duplicate");
let duplicate = false;
try {
  registry.register("duplicate");
} catch (error) {
  duplicate = error instanceof DuplicatePendingRequestError;
}
assert(duplicate, "duplicate protection");
registry.resolve("duplicate", "first");
assert((await first) === "first", "original waiter preserved");

assert(registry.resolve("missing", 1) === false, "orphan return");
assert(orphans.length === 1, "orphan diagnostic");
assert(registry.size === 0, "empty registry");
console.log(
  JSON.stringify({
    runtime: globalThis.Bun ? "bun" : globalThis.Deno ? "deno" : "node",
    passed: true,
  }),
);
