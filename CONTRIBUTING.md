# Contributing

Thanks for helping make request lifecycles safer.

## Development

Requirements:

- Node.js 18+ for the runtime package;
- Node.js 24 for the complete contributor toolchain;
- Bun and Deno for the cross-runtime matrix;
- Chrome or Playwright Chromium for browser verification.

```bash
npm ci
npm run verify
```

Every lifecycle change must include a regression test for cleanup, settlement, and orphan behavior. Protocol-specific framing, retries, and RPC method abstractions are intentionally out of scope.

## Pull requests

- Keep the zero-runtime-dependency contract.
- Preserve ESM, CommonJS, browser, Bun, Deno, and Node support.
- Document user-visible changes in `CHANGELOG.md`.
- Add a focused test that fails without the change.
- Keep diagnostic hooks unable to affect settlement.

By participating, you agree to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
