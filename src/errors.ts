/** Stable error codes exported by this package. */
export type PendingRequestsErrorCode =
  | "PENDING_REQUEST_DUPLICATE"
  | "PENDING_REQUEST_TIMEOUT"
  | "PENDING_REQUESTS_CLOSED";

/** Base class for errors created by `pending-requests`. */
export class PendingRequestsError extends Error {
  readonly code: PendingRequestsErrorCode;

  constructor(message: string, code: PendingRequestsErrorCode) {
    super(message);
    this.name = "PendingRequestsError";
    this.code = code;
  }
}

/** A new registration attempted to replace a live request with the same ID. */
export class DuplicatePendingRequestError<
  TId = unknown,
> extends PendingRequestsError {
  readonly id: TId;

  constructor(id: TId) {
    super(
      `Duplicate pending request: ${String(id)}`,
      "PENDING_REQUEST_DUPLICATE",
    );
    this.name = "DuplicatePendingRequestError";
    this.id = id;
  }
}

/** A pending request exceeded its configured deadline. */
export class PendingRequestTimeoutError<
  TId = unknown,
> extends PendingRequestsError {
  readonly id: TId;
  readonly timeout: number;

  constructor(id: TId, timeout: number) {
    super(
      `Pending request ${String(id)} timed out after ${timeout} ms`,
      "PENDING_REQUEST_TIMEOUT",
    );
    this.name = "PendingRequestTimeoutError";
    this.id = id;
    this.timeout = timeout;
  }
}

/** A registration was attempted after the registry permanently closed. */
export class PendingRequestsClosedError extends PendingRequestsError {
  constructor() {
    super("Pending request registry is closed", "PENDING_REQUESTS_CLOSED");
    this.name = "PendingRequestsClosedError";
  }
}
