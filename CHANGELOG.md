# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-08-29

### Added

- Atomic register-before-dispatch request lifecycle.
- Exactly-once resolve/reject with cleanup before settlement.
- Per-request and default deadlines with portable timeout validation.
- AbortSignal support with one listener per shared signal.
- Duplicate ID protection that preserves the original waiter.
- Metadata introspection and atomic group rejection.
- Recoverable `rejectAll` drains and terminal, idempotent `close`.
- Observable orphan settlements with diagnostic isolation.
- ESM, CommonJS, and TypeScript declarations with no runtime dependencies.

[Unreleased]: https://github.com/Atomics-hub/pending-requests/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Atomics-hub/pending-requests/releases/tag/v0.1.0
