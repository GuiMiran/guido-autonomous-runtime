# Bounded evaluation executor

Read [spec.md](spec.md) and the threat-model limits before enabling this module.
It is a dependency-free Node host adapter, separate from the existing .NET app.
It does not implement repository mutation, model generation or a general agent
runtime. SPECTRA owns expected answers and scores; this module only executes a
single-file CommonJS candidate against one JSON input.

## Trusted-host integration

Import `executeCandidate` from this directory. Supply a v1 request binding the
candidate SHA-256, canonical input SHA-256, approved immutable image digest and
bounded limits. An externally authenticated host must approve that exact request
hash with an identity and expiry no more than 24 hours ahead. This plain approval
record is **not a cryptographic identity signature**. Never obtain approvals or
executor dependencies from candidate code. Execution requires `{ enabled: true }`
and a local Docker daemon with an already available approved image; it never
pulls or falls back to running candidate code on the host.

Only a `COMPLETED` receipt with matching request/image/output hashes and confirmed
cleanup can carry a candidate result. An infrastructure or approval error must
not be presented as a verified score. Raw client diagnostics are not returned.

## Checks

```sh
cd evaluation
npm test
# Only on a disposable, secret-free Docker runner, with an independently approved image:
GUIDO_EVAL_IMAGE='node@sha256:<approved-64-hex-digest>' npm run test:integration
```

The separate workflow resolves a public image digest and tests only known
synthetic candidates. Its tag-to-digest resolution is setup for that run, not a
cross-run reproducibility pin or authorization for a private task/model trial.
Missing Docker/image fails integration; it is never silently skipped. Unit mocks
test policy but cannot prove isolation. Containers share the host kernel and are
not a security boundary against kernel exploits. Use a dedicated disposable host
without secrets and obtain owner review before executing non-synthetic code.

Future signed approvals, private oracle custody, worktrees, live provider trials
and draft-PR delivery remain separate, explicitly reviewed work.
