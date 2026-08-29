# pending-requests

[![npm version](https://img.shields.io/npm/v/pending-requests.svg)](https://www.npmjs.com/package/pending-requests)
[![weekly downloads](https://img.shields.io/npm/dw/pending-requests.svg)](https://www.npmjs.com/package/pending-requests)
[![CI](https://github.com/Atomics-hub/pending-requests/actions/workflows/ci.yml/badge.svg)](https://github.com/Atomics-hub/pending-requests/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pending-requests.svg)](./LICENSE)

A tiny, zero-dependency lifecycle registry for correlated async requests.

Use it anywhere one side sends an ID and another side eventually returns that ID: JSON-RPC, WebSockets, workers, `MessagePort`, language servers, subprocess protocols, iframe bridges, and agent transports.

```bash
npm install pending-requests
```

## Why

An `id -> { resolve, reject }` map looks simple until real lifecycle events arrive:

- the response can arrive synchronously during dispatch;
- dispatch can throw or return a rejected promise;
- two callers can accidentally reuse an ID;
- cancellation can happen before or after registration;
- timeouts, transport errors, reconnects, and disposal must reject everything they own;
- a late response must not complete a newer request or remain stored forever;
- every timer and abort listener must disappear on every terminal path.

`pending-requests` owns those invariants without owning your protocol.

## Quick start

```ts
import { PendingRequests } from "pending-requests";

const pending = new PendingRequests<number, User>({
  defaultTimeout: 10_000,
  onOrphan(event) {
    console.warn("Late or unknown response", event.id, event.source);
  },
});

function getUser(id: number, signal?: AbortSignal): Promise<User> {
  return pending.request(
    id,
    () => socket.send(JSON.stringify({ id, method: "getUser" })),
    { signal },
  );
}

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.error) pending.reject(message.id, new Error(message.error));
  else pending.resolve(message.id, message.result);
});

socket.addEventListener("close", () => {
  // Reject this connection generation, but allow requests after reconnect.
  pending.rejectAll(new Error("WebSocket disconnected"));
});

function dispose() {
  // Permanently seal the registry. Future registrations reject immediately.
  pending.close(new Error("Client disposed"));
}
```

`request()` registers **before** calling `dispatch`. A responder that fires synchronously therefore cannot beat registration. Synchronous throws, rejected dispatch promises, and hostile thenables reject and clean the same entry.

## API

### `new PendingRequests(options?)`

```ts
const pending = new PendingRequests<RequestId, Result, Metadata>({
  defaultTimeout: 30_000,
  onOrphan: (event) => diagnostics.record(event),
});
```

Options:

- `defaultTimeout?: number | false` — default deadline in milliseconds. The default is `false` (no timer).
- `onOrphan?: (event) => void` — observes unknown, late, and duplicate settlements. Exceptions from this diagnostic hook are isolated from response processing.

### `register(id, options?)`

Parks one promise without dispatching anything.

```ts
const result = pending.register(id, {
  signal,
  timeout: 5_000,
  metadata: { owner: "language-server" },
});
```

Per-request `timeout` overrides the registry default. Set it to `false` to disable a default deadline.

### `request(id, dispatch, options?)`

Atomically registers and then dispatches:

```ts
return pending.request(id, () => port.postMessage(message), { signal });
```

If registration is already aborted or the registry is closed, `dispatch` is not called.

### `resolve(id, value, source?)` / `reject(id, reason, source?)`

Settles exactly once and returns `true` when a live request existed. Unknown IDs return `false` and call `onOrphan` when configured.

```ts
if (!pending.resolve(message.id, message.result, "websocket")) {
  metrics.increment("orphan_response");
}
```

Cleanup happens before promise settlement, so observers always see the final registry state.

### `rejectWhere(predicate, reason)`

Rejects a metadata-defined group without sealing the registry:

```ts
pending.rejectWhere(
  (metadata) => metadata?.pluginId === unloadedPluginId,
  new Error("Plugin unloaded"),
);
```

Predicates are evaluated before mutation. If a predicate throws, no request is rejected.

### `rejectAll(reason)` versus `close(reason?)`

Use `rejectAll` for a recoverable connection generation. It drains current requests and remains reusable.

Use `close` for final disposal. It is idempotent, retains the first close reason, rejects every current request, and makes future registrations reject without dispatching.

### Introspection

```ts
pending.size;
pending.closed;
pending.closeReason;
pending.has(id);
pending.metadata(id);
[...pending.entries()]; // [id, metadata][]
```

There is intentionally no raw `delete()` or `clear()`: removing a live entry without settling its promise is the failure this package prevents.

## Errors

| Error                          | Code                        | Meaning                                                                   |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------- |
| `DuplicatePendingRequestError` | `PENDING_REQUEST_DUPLICATE` | A live ID would have been overwritten. The original request is preserved. |
| `PendingRequestTimeoutError`   | `PENDING_REQUEST_TIMEOUT`   | The configured request deadline won. Includes `id` and `timeout`.         |
| `PendingRequestsClosedError`   | `PENDING_REQUESTS_CLOSED`   | `close()` sealed the registry without a custom reason.                    |

All three extend `PendingRequestsError`.

Duplicate IDs and invalid timeout values throw synchronously because they are programmer errors. Pre-aborted and closed registrations return rejected promises because they are runtime lifecycle outcomes.

## Important contracts

### IDs must be unique for a connection generation

After a timeout, the registry cannot distinguish an old wire response from a new request that reused the same ID. Use monotonically increasing, UUID, or otherwise connection-lifetime-unique IDs. A protocol that deliberately reuses IDs needs its own generation token.

### Cancellation is local

Passing an `AbortSignal` rejects and cleans the local waiter. It does **not** invent a cancellation frame for your protocol. Send that frame in your own abort handler when the peer supports cancellation.

### Late responses are observable, not buffered

Unknown responses call `onOrphan` and are never retained. Some protocols intentionally allow a response before waiter registration; implement that as an explicitly bounded, expiring rendezvous layer rather than turning the safe default into an unbounded cache.

### Timers remain referenced

Request deadlines are normal referenced timers. Automatically calling `.unref()` can let Node terminate while application code is still awaiting a request, before its timeout can reject.

### Shared signals stay cheap

Ten thousand requests using the same `AbortSignal` share one listener per registry. The listener is removed as soon as its last request settles.

## Migrating a hand-written map

Before:

```ts
return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    requests.delete(id);
    reject(new Error("Timed out"));
  }, 10_000);

  requests.set(id, { resolve, reject, timeout });
  transport.send(message);
});
```

After:

```ts
return pending.request(id, () => transport.send(message), {
  timeout: 10_000,
});
```

The replacement also handles duplicate IDs, pre-abort, dispatch failure, transport drains, terminal close, late responses, and listener cleanup.

## Runtime support

- Node.js 18+
- Bun
- Deno
- Modern browsers, workers, and edge runtimes
- ESM and CommonJS

The published package has no runtime dependencies and no Node builtin imports. Both builds are held below a 3 KB gzip budget.

## Scope

This package intentionally does not implement:

- serialization or transport framing;
- retry, replay, or reconnect policy;
- protocol cancellation messages;
- persistence;
- RPC method proxies or per-method result typing.

Those belong above this lifecycle kernel—and are often the packages that should depend on it.

## Security

See [SECURITY.md](./SECURITY.md) for reporting instructions. Unknown responses are never retained, timeout values are bounded to the portable timer range, and all diagnostic hooks are isolated from settlement.

## License

MIT © Atomics Hub
