/** The terminal operation attempted for an unknown or already-settled ID. */
export type PendingRequestSettlementKind = "resolve" | "reject";

/** Diagnostic information for a late, duplicate, or otherwise unknown settlement. */
export interface OrphanedPendingRequest<TId> {
  readonly id: TId;
  readonly kind: PendingRequestSettlementKind;
  readonly value: unknown;
  readonly source: string;
}

/** Registry-wide behavior. */
export interface PendingRequestsOptions<TId> {
  /**
   * Deadline applied when a registration does not provide `timeout`.
   * Set to `false` (the default) to keep requests pending until another
   * terminal event settles them.
   */
  readonly defaultTimeout?: number | false;
  /**
   * Receives unknown, late, and duplicate settlements. Exceptions thrown by
   * this diagnostic callback are isolated from the transport response path.
   */
  readonly onOrphan?: (event: OrphanedPendingRequest<TId>) => void;
}

/** Lifecycle behavior for one pending request. */
export interface PendingRequestOptions<TMetadata> {
  /** Reject with `signal.reason` when cancellation wins. */
  readonly signal?: AbortSignal;
  /**
   * Per-request deadline in milliseconds. `false` disables a registry default.
   * Timers remain referenced so awaiting code cannot terminate before timeout.
   */
  readonly timeout?: number | false;
  /** Protocol-owned data available to `metadata`, `entries`, and predicates. */
  readonly metadata?: TMetadata;
}

/** Selects requests for a non-terminal group rejection. */
export type PendingRequestPredicate<TId, TMetadata> = (
  metadata: TMetadata | undefined,
  id: TId,
) => boolean;
