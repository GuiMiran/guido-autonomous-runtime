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
