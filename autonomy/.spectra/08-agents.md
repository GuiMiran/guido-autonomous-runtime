# Agents
AGENT-PLAN-001: Planner
Allowed capabilities: infer text from user-provided goal; generate proposed steps and verification.
Denied capabilities: direct shell, network browsing, file writes beyond trusted runtime journal, repository mutation, policy changes.
Note: The trusted host calls the configured model endpoint; model output is data, never tool authority.
