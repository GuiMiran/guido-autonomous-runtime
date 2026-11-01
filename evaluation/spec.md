# Isolated evaluation v1 — bounded Runtime contract

Status: proposed; evaluation only, not source mutation or production delivery.

SPECTRA owns suites and expected answers. Runtime receives only a single-file
CommonJS candidate, one JSON input, a hash-bound execution request and a trusted
host approval. Expected outputs, suite paths and credentials are never accepted
as container mounts or environment parameters.

An immutable request pins schemaVersion 1, purpose `isolated-evaluation`,
requestId, candidateSha256, inputSha256, a locally available image named by
`repository@sha256:digest`, and timeout/output limits. A host approval pins the
canonical request SHA-256, approvedBy and expiresAt. The approval is an explicit
host record, not a cryptographic identity signature. Real integrations must
authenticate that record outside candidate control.

Execution is opt-in and Docker-only. No Docker, disabled execution, malformed
approval, stale approval, changed source/input or unavailable image must never
fall back to an ordinary subprocess. The candidate runs as uid/gid 65534, with
no network, read-only root and candidate mount, no capabilities, no-new-privileges,
private IPC, bounded memory/CPU/PIDs and temporary storage. Docker access itself
is trusted host authority; use a dedicated disposable runner without secrets.

Only the staged candidate, entry wrapper and input are mounted. Each call uses
a generated container name. Wall timeout/output limits stop the Docker client
and force cleanup of that exact container. Cleanup failure invalidates the
receipt. Containers share the kernel: this is not a proof of containment against
kernel exploits, and it is not permission to execute hostile code on a personal
or production host.

Runtime receipts distinguish COMPLETED, CANDIDATE_ERROR, TIMEOUT, OUTPUT_LIMIT, RESOURCE_LIMIT,
UNAVAILABLE, DENIED and INFRA_ERROR. Only COMPLETED may include a JSON output.
Raw stdout/stderr are not written into public receipts. No registry, branch,
production filesystem, model API or deployment may be modified by this module.

## Verification and limits of evidence

Unit tests inspect staged files, arguments, digest/approval denial paths, timeout,
output limits and cleanup failures with a trusted fake Docker client. They never
execute a candidate on the host and do not demonstrate isolation. The separate
CI integration pulls a public Node image outside the executor, resolves its
immutable digest and runs only known synthetic candidates on a disposable
runner. It checks read-only mounts/root, uid, capabilities, network isolation,
absence of host-only files/secrets, resource policy and cleanup. No private task
corpus or real model provider is included, and no container escape resistance is
claimed. Owner review is required before use with non-synthetic candidates.

The executor does not fetch an image or mutate source. A future worktree/action
runtime and signed approval identities remain separate work. SPECTRA remains
responsible for scoring and must reject receipts with an unconfirmed cleanup.
