# Production audit

Audit date: 2026-08-29

## Result

`pending-requests@0.1.0` passed the complete release verification command:

```bash
npm run verify
```

## Verified surfaces

| Surface                    | Result                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| Formatting and static lint | Pass, zero warnings                                                             |
| Strict TypeScript          | Pass                                                                            |
| Behavioral tests           | 29 pass, 0 fail                                                                 |
| Runtime source coverage    | 100% statements, branches, functions, and lines                                 |
| Property testing           | 2,000 generated terminal-event sequences                                        |
| Throughput stress          | 1,000,000 register/settle cycles; zero retained entries or unhandled rejections |
| Concurrency stress         | 100,000 requests on one shared signal; one listener; zero retained entries      |
| Server runtimes            | Node, Bun, and Deno pass                                                        |
| Browser runtime            | Chrome 151; 10,007 operations; zero retained entries                            |
| Module formats             | ESM and CommonJS pass from an isolated tarball installation                     |
| Type packaging             | Are The Types Wrong: all green; Publint: all good                               |
| Bundle budget              | ESM 2,344 bytes gzip; CommonJS 2,766 bytes gzip                                 |
| Packed consumer            | Pass for ESM, CommonJS, and TypeScript                                          |
| Published contents         | 11 allowlisted files; no source, tests, scripts, or repository metadata         |
| Runtime dependencies       | None                                                                            |
| npm security audit         | Zero known vulnerabilities                                                      |

The packed artifact was 14,588 bytes compressed and 75,700 bytes unpacked during the final gate. Exact hashes change whenever documentation, source maps, or build output changes.

## Lifecycle cases covered

- synchronous response during dispatch;
- synchronous and asynchronous dispatch failures;
- hostile thenables;
- pre-abort and abort during listener installation;
- one listener shared across many requests;
- listener setup and cleanup exceptions;
- per-request, default, disabled, and invalid timeouts;
- duplicate ID preservation and post-settlement reuse;
- metadata group rejection and predicate atomicity;
- recoverable drains and terminal close;
- late, duplicate, and unknown settlements;
- diagnostic callback isolation;
- cleanup before promise settlement;
- randomized first-terminal-event wins.

## Intentional boundaries

The audit does not claim to solve protocol identity after caller-chosen wire ID reuse. IDs must remain unique for a connection generation. Abort is local and does not send a protocol cancellation frame. Unknown responses are observed and discarded rather than buffered. Serialization, framing, retries, replay, reconnect policy, persistence, and RPC method typing remain out of scope.

## Remaining launch risk

Correctness and packaging are verified; adoption is not. The launch strategy should pursue upstream integrations into projects with private pending-request maps rather than rely on passive npm discovery.
