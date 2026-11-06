const ALLOWED_ACTIONS = new Set(['task.plan', 'task.read', 'task.list', 'task.submit']);
const FORBIDDEN_ACTIONS = new Set([
  'shell.execute', 'github.push', 'github.merge', 'deploy.production',
  'secrets.read', 'policy.modify', 'agent.grant_privileges'
]);

export function decide(action, context = {}) {
  if (typeof action !== 'string' || !action) return { allowed: false, reason: 'INVALID_ACTION' };
  if (FORBIDDEN_ACTIONS.has(action)) return { allowed: false, reason: 'DENIED_BY_POLICY' };
  if (!ALLOWED_ACTIONS.has(action)) return { allowed: false, reason: 'NOT_ALLOWLISTED' };
  if (context.ownerAuthenticated !== true) return { allowed: false, reason: 'UNAUTHENTICATED' };
  return { allowed: true, reason: 'ALLOWLISTED' };
}
