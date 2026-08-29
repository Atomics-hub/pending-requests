import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DuplicatePendingRequestError,
  PendingRequestsClosedError,
  PendingRequestsError,
  PendingRequestTimeoutError,
} from "../../src/index.js";

describe("exported errors", () => {
  it("exposes stable names, codes, and context", () => {
    const duplicate = new DuplicatePendingRequestError("id");
    assert.equal(duplicate.name, "DuplicatePendingRequestError");
    assert.equal(duplicate.code, "PENDING_REQUEST_DUPLICATE");
    assert.equal(duplicate.id, "id");
    assert.equal(duplicate instanceof PendingRequestsError, true);
    assert.match(duplicate.message, /id/);

    const timeout = new PendingRequestTimeoutError(7, 50);
    assert.equal(timeout.name, "PendingRequestTimeoutError");
    assert.equal(timeout.code, "PENDING_REQUEST_TIMEOUT");
    assert.equal(timeout.id, 7);
    assert.equal(timeout.timeout, 50);
    assert.match(timeout.message, /50 ms/);

    const closed = new PendingRequestsClosedError();
    assert.equal(closed.name, "PendingRequestsClosedError");
    assert.equal(closed.code, "PENDING_REQUESTS_CLOSED");
  });
});
