# Security policy

## Supported versions

The latest published minor version receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for `Atomics-hub/pending-requests`:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include affected versions, impact, a minimal reproduction, and any suggested mitigation.

We aim to acknowledge reports within 72 hours. Confirmed issues will receive a coordinated fix and advisory before public technical details are discussed.

## Security boundaries

`pending-requests` owns in-memory waiter lifecycle only. It does not authenticate peers, validate protocol messages, generate IDs, encrypt traffic, or authorize operations. Callers must validate untrusted IDs and payloads before passing them to the registry.
