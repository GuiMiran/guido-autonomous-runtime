# Acceptance criteria
- AC-AI-001: Invalid owner credentials return 401. Test: unauthenticated clients cannot submit work.
- AC-AI-002: Unknown and privileged actions are denied. Test: policy is fail closed.
- AC-AI-003: Planning task reaches COMPLETED only after inference result. Test: task is persisted, planned, and audited.
- AC-AI-004: Model failure yields FAILED without leaking exception details. Test: model failures do not become verified success.
- AC-AI-005: Service can restart with queued work: acceptance test pending.
- AC-AI-006: Exactly-once external tool effects: out of scope; none enabled.

- AC-AI-007: Same Idempotency-Key/payload never creates a second task; conflicting payload fails with 409, including after restart. Test: inference-adapter.test.js.
- AC-AI-008: Native Ollama planning sets a single CPU thread, bounded context and a bounded completion. Test: inference-adapter.test.js.
- AC-AI-009: A source retrieval failure is separate from an inference failure, and never calls the model. Test: inference-adapter.test.js.
- AC-AI-010: Oversized source context is marked as partial instead of silently claiming full-document review. Test: inference-adapter.test.js.
