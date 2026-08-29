import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { PendingRequests } from "../../src/index.js";

type Terminal = "resolve" | "reject" | "abort" | "close";

const outcome = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ status: "resolved" as const, value }),
    (value: unknown) => ({ status: "rejected" as const, value }),
  );

describe("adversarial lifecycle properties", () => {
  it("lets exactly the first terminal event win", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<Terminal>("resolve", "reject", "abort", "close"),
          {
            minLength: 1,
            maxLength: 30,
          },
        ),
        async (terminals) => {
          const registry = new PendingRequests<string, number>();
          const controller = new AbortController();
          const promise = outcome(
            registry.register("id", { signal: controller.signal }),
          );
          const expectedKind = terminals[0];

          for (const [index, terminal] of terminals.entries()) {
            if (terminal === "resolve") registry.resolve("id", index);
            if (terminal === "reject") registry.reject("id", index);
            if (terminal === "abort") controller.abort(index);
            if (terminal === "close") registry.close(index);
          }

          const result = await promise;
          assert.equal(
            result.status,
            expectedKind === "resolve" ? "resolved" : "rejected",
          );
          assert.equal(result.value, 0);
          assert.equal(registry.size, 0);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});
