import {
  DuplicatePendingRequestError,
  PendingRequestsClosedError,
  PendingRequestTimeoutError,
} from "./errors.js";
import type {
  OrphanedPendingRequest,
  PendingRequestOptions,
  PendingRequestPredicate,
  PendingRequestsOptions,
  PendingRequestSettlementKind,
} from "./types.js";

const MAX_TIMEOUT = 2_147_483_647;
const DEFAULT_SOURCE = "response";

interface SignalGroup<TId> {
  readonly ids: Set<TId>;
  readonly onAbort: () => void;
}

interface PendingEntry<TId, TResult, TMetadata> {
  readonly resolve: (value: TResult | PromiseLike<TResult>) => void;
  readonly reject: (reason?: unknown) => void;
  readonly metadata: TMetadata | undefined;
  readonly signal: AbortSignal | undefined;
  signalGroup?: SignalGroup<TId>;
  timer?: ReturnType<typeof setTimeout>;
}

function validateTimeout(
  timeout: number | false | undefined,
  label: string,
): void {
  if (timeout === false || timeout === undefined) return;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > MAX_TIMEOUT) {
    throw new RangeError(
      `${label} must be false or a finite number from 0 to ${MAX_TIMEOUT}`,
    );
  }
}

function fallbackAbortReason(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? fallbackAbortReason();
}

/**
 * Owns the lifecycle of promises correlated by request IDs.
 *
 * The registry deliberately does not implement framing, serialization,
 * protocol cancellation messages, retries, or reconnect policy.
 */
export class PendingRequests<
  TId = string | number,
  TResult = unknown,
  TMetadata = undefined,
> {
  readonly #entries = new Map<TId, PendingEntry<TId, TResult, TMetadata>>();
  readonly #signalGroups = new WeakMap<AbortSignal, SignalGroup<TId>>();
  readonly #defaultTimeout: number | false;
  readonly #onOrphan:
    ((event: OrphanedPendingRequest<TId>) => void) | undefined;
  #closed = false;
  #closeReason: unknown;

  constructor(options: PendingRequestsOptions<TId> = {}) {
    validateTimeout(options.defaultTimeout, "defaultTimeout");
    this.#defaultTimeout = options.defaultTimeout ?? false;
    this.#onOrphan = options.onOrphan;
  }

  /** Number of requests that have not reached a terminal path. */
  get size(): number {
    return this.#entries.size;
  }

  /** Whether `close` has permanently sealed this registry. */
  get closed(): boolean {
    return this.#closed;
  }

  /** The reason retained by the first successful `close`, if closed. */
  get closeReason(): unknown {
    return this.#closeReason;
  }

  /** Whether `id` currently owns a live waiter. */
  has(id: TId): boolean {
    return this.#entries.has(id);
  }

  /** Metadata associated with a live request, or `undefined` if absent. */
  metadata(id: TId): TMetadata | undefined {
    return this.#entries.get(id)?.metadata;
  }

  /** Snapshot-friendly iteration over live IDs and metadata. */
  *entries(): IterableIterator<readonly [TId, TMetadata | undefined]> {
    for (const [id, entry] of this.#entries)
      yield [id, entry.metadata] as const;
  }

  /**
   * Register one pending request.
   *
   * Duplicate IDs and invalid timeouts throw synchronously as programmer
   * errors. Closed and pre-aborted registrations return rejected promises.
   */
  register(
    id: TId,
    options: PendingRequestOptions<TMetadata> = {},
  ): Promise<TResult> {
    if (this.#closed) return Promise.reject(this.#closeReason);
    if (this.#entries.has(id)) throw new DuplicatePendingRequestError(id);

    const timeout =
      options.timeout === undefined ? this.#defaultTimeout : options.timeout;
    validateTimeout(timeout, "timeout");
    if (options.signal?.aborted)
      return Promise.reject(abortReason(options.signal));

    let resolve!: (value: TResult | PromiseLike<TResult>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<TResult>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const entry: PendingEntry<TId, TResult, TMetadata> = {
      resolve,
      reject,
      metadata: options.metadata,
      signal: options.signal,
    };
    this.#entries.set(id, entry);

    try {
      if (options.signal) this.#attachSignal(id, entry, options.signal);
      if (timeout !== false) {
        entry.timer = setTimeout(() => {
          this.reject(
            id,
            new PendingRequestTimeoutError(id, timeout),
            "timeout",
          );
        }, timeout);
      }
    } catch (error) {
      this.reject(id, error, "setup");
    }

    // Covers abort between the first check and listener installation.
    if (options.signal?.aborted)
      this.reject(id, abortReason(options.signal), "abort");
    return promise;
  }

  /**
   * Register before dispatch so a synchronous responder cannot win the race.
   * Dispatch throws, rejected promises, and hostile thenables reject and clean
   * the same entry.
   */
  request(
    id: TId,
    dispatch: () => unknown,
    options: PendingRequestOptions<TMetadata> = {},
  ): Promise<TResult> {
    const promise = this.register(id, options);
    if (!this.#entries.has(id)) return promise;

    let dispatched: unknown;
    try {
      dispatched = dispatch();
    } catch (error) {
      this.reject(id, error, "dispatch");
      return promise;
    }

    if (dispatched !== undefined) {
      Promise.resolve(dispatched).catch((error: unknown) => {
        this.reject(id, error, "dispatch");
      });
    }
    return promise;
  }

  /** Resolve a request exactly once, returning whether a live entry existed. */
  resolve(id: TId, value: TResult, source = DEFAULT_SOURCE): boolean {
    return this.#settle(id, "resolve", value, source);
  }

  /** Reject a request exactly once, returning whether a live entry existed. */
  reject(id: TId, reason: unknown, source = DEFAULT_SOURCE): boolean {
    return this.#settle(id, "reject", reason, source);
  }

  /**
   * Reject matching requests without closing the registry.
   * Predicates are evaluated before mutation, so a thrown predicate leaves the
   * registry unchanged.
   */
  rejectWhere(
    predicate: PendingRequestPredicate<TId, TMetadata>,
    reason: unknown,
  ): number {
    const selected: TId[] = [];
    for (const [id, entry] of this.#entries) {
      if (predicate(entry.metadata, id)) selected.push(id);
    }

    let count = 0;
    for (const id of selected) {
      if (this.#entries.has(id) && this.reject(id, reason, "group")) count += 1;
    }
    return count;
  }

  /** Reject every live request while keeping the registry reusable. */
  rejectAll(reason: unknown): number {
    const ids = [...this.#entries.keys()];
    let count = 0;
    for (const id of ids) {
      if (this.#entries.has(id) && this.reject(id, reason, "drain")) count += 1;
    }
    return count;
  }

  /** Permanently seal the registry and reject every live request. */
  close(reason: unknown = new PendingRequestsClosedError()): boolean {
    if (this.#closed) return false;
    this.#closed = true;
    this.#closeReason = reason;
    const ids = [...this.#entries.keys()];
    for (const id of ids) {
      if (this.#entries.has(id)) this.reject(id, reason, "close");
    }
    return true;
  }

  #attachSignal(
    id: TId,
    entry: PendingEntry<TId, TResult, TMetadata>,
    signal: AbortSignal,
  ): void {
    let group = this.#signalGroups.get(signal);
    const created = group === undefined;
    if (!group) {
      const createdGroup: SignalGroup<TId> = {
        ids: new Set<TId>(),
        onAbort: () => {
          for (const pendingId of createdGroup.ids) {
            this.reject(pendingId, abortReason(signal), "abort");
          }
        },
      };
      group = createdGroup;
      this.#signalGroups.set(signal, group);
    }

    group.ids.add(id);
    entry.signalGroup = group;
    if (created)
      signal.addEventListener("abort", group.onAbort, { once: true });
  }

  #settle(
    id: TId,
    kind: PendingRequestSettlementKind,
    value: unknown,
    source: string,
  ): boolean {
    const entry = this.#entries.get(id);
    if (!entry) {
      this.#reportOrphan({ id, kind, value, source });
      return false;
    }

    // Cleanup precedes settlement so reentrant observers see final state.
    this.#entries.delete(id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.signalGroup) {
      entry.signalGroup.ids.delete(id);
      if (entry.signalGroup.ids.size === 0 && entry.signal) {
        try {
          entry.signal.removeEventListener("abort", entry.signalGroup.onAbort);
        } catch {
          // A non-native signal cannot prevent promise settlement.
        }
        this.#signalGroups.delete(entry.signal);
      }
    }

    if (kind === "resolve") entry.resolve(value as TResult);
    else entry.reject(value);
    return true;
  }

  #reportOrphan(event: OrphanedPendingRequest<TId>): void {
    try {
      this.#onOrphan?.(event);
    } catch {
      // Diagnostics cannot destabilize request processing.
    }
  }
}
