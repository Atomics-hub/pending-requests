import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import {
  DuplicatePendingRequestError,
  PendingRequests,
  PendingRequestsClosedError,
  PendingRequestTimeoutError,
} from "../../src/index.js";

const outcome = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ status: "resolved" as const, value }),
    (value: unknown) => ({ status: "rejected" as const, value }),
  );

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PendingRequests", () => {
  it("registers, introspects, and resolves one request", async () => {
    const registry = new PendingRequests<string, number, { owner: string }>();
    assert.equal(registry.size, 0);
    assert.equal(registry.closed, false);
    assert.equal(registry.closeReason, undefined);

    const promise = registry.register("one", { metadata: { owner: "worker" } });
    assert.equal(registry.size, 1);
    assert.equal(registry.has("one"), true);
    assert.deepEqual(registry.metadata("one"), { owner: "worker" });
    assert.deepEqual([...registry.entries()], [["one", { owner: "worker" }]]);
    assert.equal(registry.resolve("one", 42), true);
    assert.equal(registry.has("one"), false);
    assert.equal(registry.size, 0);
    assert.equal(await promise, 42);
  });

  it("rejects with the original reason", async () => {
    const registry = new PendingRequests<string, number>();
    const reason = { code: "transport" };
    const promise = registry.register("one");
    assert.equal(registry.reject("one", reason), true);
    assert.deepEqual(await outcome(promise), {
      status: "rejected",
      value: reason,
    });
  });

  it("registers before dispatch so synchronous responses cannot race", async () => {
    const registry = new PendingRequests<string, number>();
    const promise = registry.request("sync", () => {
      assert.equal(registry.has("sync"), true);
      registry.resolve("sync", 42);
    });
    assert.equal(await promise, 42);
    assert.equal(registry.size, 0);
  });

  it("keeps a request pending when dispatch returns undefined", async () => {
    const registry = new PendingRequests<string, number>();
    const promise = registry.request("async", () => undefined);
    assert.equal(registry.has("async"), true);
    registry.resolve("async", 9);
    assert.equal(await promise, 9);
  });

  it("cleans synchronous dispatch failures", async () => {
    const registry = new PendingRequests<string, number>();
    const reason = new Error("write failed");
    const promise = registry.request("write", () => {
      throw reason;
    });
    assert.equal((await outcome(promise)).value, reason);
    assert.equal(registry.size, 0);
  });

  it("cleans asynchronous dispatch failures", async () => {
    const registry = new PendingRequests<string, number>();
    const reason = new Error("async write failed");
    const promise = registry.request("write", () => Promise.reject(reason));
    assert.equal((await outcome(promise)).value, reason);
    assert.equal(registry.size, 0);
  });

  it("cleans hostile thenables whose then getter throws", async () => {
    const registry = new PendingRequests<string, number>();
    const reason = new Error("hostile thenable");
    const promise = registry.request("write", () => ({
      // oxlint-disable-next-line unicorn/no-thenable -- adversarial thenable fixture
      get then() {
        throw reason;
      },
    }));
    assert.equal((await outcome(promise)).value, reason);
    assert.equal(registry.size, 0);
  });

  it("does not dispatch a pre-aborted request", async () => {
    const registry = new PendingRequests<string, number>();
    const controller = new AbortController();
    const reason = new Error("already aborted");
    controller.abort(reason);
    let dispatched = false;
    const promise = registry.request(
      "one",
      () => {
        dispatched = true;
      },
      { signal: controller.signal },
    );
    assert.equal((await outcome(promise)).value, reason);
    assert.equal(dispatched, false);
    assert.equal(registry.size, 0);
  });

  it("provides a portable AbortError fallback for signal-like inputs without a reason", async () => {
    const signal = {
      aborted: true,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as AbortSignal;
    const registry = new PendingRequests<string, number>();
    const result = await outcome(registry.register("one", { signal }));
    assert.equal(result.status, "rejected");
    assert.equal((result.value as Error).name, "AbortError");
  });

  it("catches an abort that races listener installation", async () => {
    let checks = 0;
    const reason = new Error("raced abort");
    const signal = {
      get aborted() {
        checks += 1;
        return checks > 1;
      },
      reason,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as AbortSignal;
    const registry = new PendingRequests<string, number>();
    assert.equal(
      (await outcome(registry.register("one", { signal }))).value,
      reason,
    );
    assert.equal(registry.size, 0);
  });

  it("removes an AbortSignal listener after normal settlement", async () => {
    const registry = new PendingRequests<string, number>();
    const controller = new AbortController();
    const promise = registry.register("one", { signal: controller.signal });
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    registry.resolve("one", 1);
    assert.equal(await promise, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

  it("multiplexes a shared signal through one listener", async () => {
    const registry = new PendingRequests<number, number>();
    const controller = new AbortController();
    const promises = Array.from({ length: 10_000 }, (_, id) =>
      outcome(registry.register(id, { signal: controller.signal })),
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    const reason = new Error("transport closed");
    controller.abort(reason);
    const results = await Promise.all(promises);
    assert.equal(
      results.every((result) => result.value === reason),
      true,
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(registry.size, 0);
  });

  it("settles even when a signal-like removeEventListener throws", async () => {
    let onAbort: (() => void) | undefined;
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener(_type: string, listener: () => void) {
        onAbort = listener;
      },
      removeEventListener() {
        throw new Error("hostile cleanup");
      },
    } as unknown as AbortSignal;
    const registry = new PendingRequests<string, number>();
    const promise = registry.register("one", { signal });
    assert.equal(typeof onAbort, "function");
    assert.equal(registry.resolve("one", 1), true);
    assert.equal(await promise, 1);
  });

  it("rejects and cleans if signal listener setup throws", async () => {
    const reason = new Error("listener setup failed");
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener() {
        throw reason;
      },
      removeEventListener() {},
    } as unknown as AbortSignal;
    const registry = new PendingRequests<string, number>();
    const result = await outcome(registry.register("one", { signal }));
    assert.equal(result.value, reason);
    assert.equal(registry.size, 0);
  });

  it("enforces per-request and default timeouts", async () => {
    const registry = new PendingRequests<string, number>({ defaultTimeout: 5 });
    const defaultResult = await outcome(registry.register("default"));
    assert.equal(
      defaultResult.value instanceof PendingRequestTimeoutError,
      true,
    );
    assert.equal(
      (defaultResult.value as PendingRequestTimeoutError).timeout,
      5,
    );

    const overrideResult = await outcome(
      registry.register("override", { timeout: 1 }),
    );
    assert.equal(
      (overrideResult.value as PendingRequestTimeoutError).timeout,
      1,
    );

    const noTimeout = registry.register("disabled", { timeout: false });
    await turn();
    assert.equal(registry.has("disabled"), true);
    registry.resolve("disabled", 3);
    assert.equal(await noTimeout, 3);
  });

  it("validates timeout bounds before creating entries", () => {
    assert.throws(
      () => new PendingRequests({ defaultTimeout: -1 }),
      RangeError,
    );
    assert.throws(
      () => new PendingRequests({ defaultTimeout: Number.NaN }),
      RangeError,
    );
    assert.throws(
      () => new PendingRequests({ defaultTimeout: Number.POSITIVE_INFINITY }),
      RangeError,
    );
    assert.throws(
      () => new PendingRequests({ defaultTimeout: 2_147_483_648 }),
      RangeError,
    );
    assert.doesNotThrow(
      () => new PendingRequests({ defaultTimeout: 2_147_483_647 }),
    );
    assert.doesNotThrow(() => new PendingRequests({ defaultTimeout: false }));

    const registry = new PendingRequests<string, number>();
    assert.throws(() => registry.register("one", { timeout: -1 }), RangeError);
    assert.equal(registry.size, 0);
  });

  it("rejects duplicate IDs without disturbing the original waiter", async () => {
    const registry = new PendingRequests<string, number>();
    const first = registry.register("same");
    assert.throws(
      () => registry.register("same"),
      (error) =>
        error instanceof DuplicatePendingRequestError && error.id === "same",
    );
    assert.equal(registry.size, 1);
    registry.resolve("same", 1);
    assert.equal(await first, 1);
  });

  it("allows an ID to be reused only after settlement", async () => {
    const registry = new PendingRequests<string, number>();
    const first = registry.register("same");
    registry.resolve("same", 1);
    assert.equal(await first, 1);
    const second = registry.register("same");
    registry.resolve("same", 2);
    assert.equal(await second, 2);
  });

  it("rejects selected metadata groups and preserves the rest", async () => {
    const registry = new PendingRequests<string, number, { owner: number }>();
    const one = outcome(registry.register("one", { metadata: { owner: 1 } }));
    const two = registry.register("two", { metadata: { owner: 2 } });
    const three = outcome(
      registry.register("three", { metadata: { owner: 1 } }),
    );
    const reason = new Error("owner unloaded");
    assert.equal(
      registry.rejectWhere((metadata) => metadata?.owner === 1, reason),
      2,
    );
    assert.equal((await one).value, reason);
    assert.equal((await three).value, reason);
    assert.equal(registry.has("two"), true);
    registry.resolve("two", 2);
    assert.equal(await two, 2);
  });

  it("evaluates group predicates before mutation", async () => {
    const registry = new PendingRequests<string, number>();
    const one = outcome(registry.register("one"));
    const two = outcome(registry.register("two"));
    assert.throws(
      () =>
        registry.rejectWhere((_metadata, id) => {
          if (id === "two") throw new Error("predicate failed");
          return true;
        }, new Error("group")),
      /predicate failed/,
    );
    assert.equal(registry.size, 2);
    registry.rejectAll("cleanup");
    await Promise.all([one, two]);
  });

  it("drains without sealing a reconnecting registry", async () => {
    const registry = new PendingRequests<string, number>();
    const oldOne = outcome(registry.register("old-one"));
    const oldTwo = outcome(registry.register("old-two"));
    const reason = new Error("disconnected");
    assert.equal(registry.rejectAll(reason), 2);
    assert.equal((await oldOne).value, reason);
    assert.equal((await oldTwo).value, reason);
    assert.equal(registry.closed, false);
    assert.equal(registry.rejectAll(reason), 0);

    const fresh = registry.register("fresh");
    registry.resolve("fresh", 7);
    assert.equal(await fresh, 7);
  });

  it("closes permanently, idempotently, and retains the first reason", async () => {
    const registry = new PendingRequests<string, number>();
    const pending = outcome(registry.register("one"));
    const reason = new Error("disposed");
    assert.equal(registry.close(reason), true);
    assert.equal(registry.close(new Error("second")), false);
    assert.equal(registry.closed, true);
    assert.equal(registry.closeReason, reason);
    assert.equal((await pending).value, reason);
    assert.equal((await outcome(registry.register("two"))).value, reason);

    let dispatched = false;
    const afterClose = registry.request("three", () => {
      dispatched = true;
    });
    assert.equal((await outcome(afterClose)).value, reason);
    assert.equal(dispatched, false);
  });

  it("uses a typed default reason when close has none", async () => {
    const registry = new PendingRequests<string, number>();
    const pending = outcome(registry.register("one"));
    registry.close();
    assert.equal(
      (await pending).value instanceof PendingRequestsClosedError,
      true,
    );
    assert.equal(
      registry.closeReason instanceof PendingRequestsClosedError,
      true,
    );
  });

  it("reports orphan settlements without retaining them", () => {
    const events: unknown[] = [];
    const registry = new PendingRequests<string, number>({
      onOrphan: (event) => events.push(event),
    });
    assert.equal(registry.resolve("missing", 1, "wire"), false);
    assert.equal(registry.reject("missing", "late", "peer"), false);
    assert.deepEqual(events, [
      { id: "missing", kind: "resolve", value: 1, source: "wire" },
      { id: "missing", kind: "reject", value: "late", source: "peer" },
    ]);
    assert.equal(registry.size, 0);
  });

  it("isolates exceptions thrown by orphan diagnostics", () => {
    const registry = new PendingRequests<string, number>({
      onOrphan: () => {
        throw new Error("diagnostic failed");
      },
    });
    assert.doesNotThrow(() => registry.resolve("missing", 1));
  });

  it("removes bookkeeping before user-visible settlement", async () => {
    const registry = new PendingRequests<string, number>();
    const controller = new AbortController();
    const promise = registry.register("one", {
      signal: controller.signal,
      timeout: 60_000,
    });
    const observed = promise.then(() => ({
      has: registry.has("one"),
      listeners: getEventListeners(controller.signal, "abort").length,
    }));
    registry.resolve("one", 1);
    assert.equal(registry.has("one"), false);
    assert.deepEqual(await observed, { has: false, listeners: 0 });
  });

  it("supports object IDs when callers opt into them", async () => {
    const id = { connection: 1 };
    const registry = new PendingRequests<typeof id, string>();
    const promise = registry.register(id);
    registry.resolve(id, "ok");
    assert.equal(await promise, "ok");
  });
});
