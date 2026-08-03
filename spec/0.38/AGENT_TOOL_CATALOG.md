# Static agent tool catalog

`agent-tools.json` is a deterministic, static, agent-audience contract derived only from operation manifest v11 and capability manifest v10.

Each action and query becomes exactly one tool with its stable operation ID, authored name, closed standalone JSON Schema 2020-12 input and output documents, error classes, read-only annotation, and exact authenticated HTTP `POST` binding. The authenticated caller is never request input.

Action tools also expose the authenticated applicability endpoint, its four fixed outcomes, safe authorization/precondition/revision rule IDs, static reliability, and declared emitted-event IDs. Applicability always declares `grantsAuthority: false`. Query tools expose bounded cardinality and maximum result count plus declared sorting, conditional disclosure, and private read-evidence profile metadata where present.

The catalog view must declare that it is static, not authorization-filtered, expression-free, current-state-free, extension-free, non-authoritative, and subject to runtime authorization. Schemas inline enum and nested projection definitions and close every modeled object with `additionalProperties: false`.

`adapter.compatibility: mcpTool` means an adapter can translate the catalog to MCP tool declarations. `directProtocolConformance: false` means the artifact neither implements MCP transport/lifecycle behavior nor claims MCP server conformance. The catalog alone does not satisfy SML-Agent.
