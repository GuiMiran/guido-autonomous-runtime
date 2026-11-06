# GUIDO Autonomous Control Plane — Vision
Status: MVP proposal. Owner: Guido Miranda Mercado.

Purpose: run persistent, auditable planning tasks against an independently hosted model. This is NOT autonomous code execution or production deployment.

Boundary: HTTP endpoint bound to localhost by default; pre-shared owner bearer token; bounded local event journal. Model output is untrusted text and never executed as code, shell or tool calls.

Out of scope: production authentication, multi-tenant use, general MCP, remote tool calling, permissions delegation, autonomous GitHub mutation, self-modification, highly available storage, inference provisioning.
