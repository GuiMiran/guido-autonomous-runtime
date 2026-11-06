# Invariants
- INV-AI-001: Deny unknown actions and unauthenticated actions.
- INV-AI-002: The model never controls runtime permissions.
- INV-AI-003: Every state transition is recorded in a local task event journal and summarized in the audit log.
- INV-AI-004: Errors returned through the API do not leak upstream exception details.
- INV-AI-005: A restart requeues interrupted planning tasks; planning has no side effects.
- INV-AI-006: No write tools, deploy tools, shell or GitHub mutations are enabled in this phase.
