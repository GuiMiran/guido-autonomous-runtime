# Business rules
- BR-AI-001: Only an authenticated owner can submit, list and read tasks.
- BR-AI-002: Work is limited to planning text; planning must not call external tools other than configured model inference.
- BR-AI-003: If inference fails, task status is FAILED, never COMPLETED.
- BR-AI-004: An explicit administrator-approved future phase is required before adding side-effecting tools.
- BR-AI-005: The application does not expose the configured model server to the public Internet.
- BR-AI-006: Never put real credentials in Git, traces or model-generated content.
