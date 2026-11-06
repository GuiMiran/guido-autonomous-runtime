# GUIDO Autonomous Control Plane — Stage 1

This is a **planning-only**, bounded, local service. It is not a general autonomous agent or hardened Internet API.

## Requirements
Node.js >=20, a separate inference server exposing the OpenAI-compatible Chat Completions endpoint, preferably local vLLM.

## Run
```bash
cd autonomy
npm test
cp .env.example .env
# Replace both placeholder tokens with securely generated random secrets.
# Source .env securely in your own shell/service manager.
GUIDO_API_TOKEN='<secure-32+-character-token>' GUIDO_MODEL_TOKEN='<vllm-token>' npm start
```

Submit:
```bash
curl -sS http://127.0.0.1:8787/v1/tasks \
  -H "Authorization: Bearer $GUIDO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Propose a test plan for a fictional REST API"}'
```
Read task: GET /v1/tasks/{id} with same bearer header.

The process does not load `.env` automatically. Use a secured service environment mechanism; never paste secrets into shell history, CI logs or PR discussions.

## Guarantees and limitations
- Explicit allowlist for task methods; no shell, GitHub write, MCP, deployment or model-driven tools.
- JSONL event persistence with restart recovery for interrupted planning. JSONL is **not** transactional, horizontally scalable or tamper-proof.
- Audit events omit raw user prompts and raw plans, but an authenticated GET exposes task content. The journal contains goals and plans in plaintext; disk encryption and file permissions matter.
- Local bearer-token auth is MVP only. Production requires trusted identity, rate limits, TLS reverse proxy, robust database transactionality and out-of-band secret management.
- Do not expose HTTP port 8787 to the Internet. Keep it on localhost or a private authenticated overlay.
- The model endpoint is an outbound trusted inference dependency; do not pass an arbitrary request-supplied URL.
- This service has no access to SPECTRA write operations; the specs here are a proposed project slice, not a claim that native Spectra verification passes.

## Next phase
Replace JSONL with PostgreSQL outbox + work queue; add administrator identity, policy-based capability grants, bounded sandbox workers, signed approval records, invariant tests, observability and controlled GitHub PR integration.
