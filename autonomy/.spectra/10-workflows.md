# Workflows
WORKFLOW-PLAN-001:
1. Authenticate request.
2. Validate goal and enqueue task.
3. Scheduler acquires queued task.
4. Request proposed plan from configured inference service.
5. Persist completed or failed state.
6. Record audit event.
7. Return task result to authenticated owner.
