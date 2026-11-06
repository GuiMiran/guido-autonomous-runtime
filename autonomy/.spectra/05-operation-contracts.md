# Operation contracts
## POST /v1/tasks
Preconditions: Bearer owner token is valid; JSON body has nonempty goal <=4000 chars; pending workload <100.
Postconditions: 202 with UUID and queued status, or appropriate error. Submitted goal is persisted; audit stores goal hash.

## GET /v1/tasks
Preconditions: authenticated owner.
Postconditions: task metadata list without goals or plans.

## GET /v1/tasks/{id}
Preconditions: authenticated owner; UUID-shaped task ID.
Postconditions: task detail if known; 404 otherwise.

## Planner tick
Preconditions: queued task; no concurrent tick.
Postconditions: completed + bounded plan, or failed + generic error. Audit records event, never raw model output.

## Idempotent submission
Optional request header: `Idempotency-Key` (1–128 safe ASCII characters).
Same key and identical objective/repository returns HTTP 200 and the existing task ID, across restart.
Same key for a different objective/repository returns HTTP 409 without queueing.
Missing key retains the existing HTTP 202 behavior.

## Native Ollama planning
The trusted host calls the internal Ollama `/api/generate` endpoint.
The model may only return untrusted plan text. No code or tool calls are executed.
The native request limits CPU threads (1), context (1536) and output tokens (128).
