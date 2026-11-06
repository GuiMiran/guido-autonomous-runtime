# Acceptance criteria
- AC-AI-001: Invalid owner credentials return 401. Test: unauthenticated clients cannot submit work.
- AC-AI-002: Unknown and privileged actions are denied. Test: policy is fail closed.
- AC-AI-003: Planning task reaches COMPLETED only after inference result. Test: task is persisted, planned, and audited.
- AC-AI-004: Model failure yields FAILED without leaking exception details. Test: model failures do not become verified success.
- AC-AI-005: Service can restart with queued work: acceptance test pending.
- AC-AI-006: Exactly-once external tool effects: out of scope; none enabled.
