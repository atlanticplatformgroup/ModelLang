# ModelLang 0.13 UI-generation conformance

The 0.13 implementation is conformant when:

1. All 0.12 language, transport, identity, enforcement, migration, and golden-artifact tests continue to pass.
2. Source grammar, canonical IR9, operation manifest v1, HTTP routes, public operation shapes, and PostgreSQL output remain unchanged.
3. Every compilation deterministically emits `ui.json` conforming to `schemas/ui-manifest.schema.json` and declaring UI manifest version 1 and operation manifest version 1.
4. UI metadata is derived exclusively from operation manifest v1 and exposes no SQL, PostgreSQL types, database roles, connection details, or server gateway contract.
5. Authenticated caller parameters are absent from all action fields and query filters, and `authentication.callerInput` is false.
6. Stable semantic IDs bind every described durable declaration, option, field, action, and query; callable fields preserve their operation-manifest parameter identifiers, and renaming an operation preserves its UI operation ID.
7. Default labels and presentation types follow the deterministic mappings in `UI_MANIFEST.md`.
8. Money descriptors preserve exact currency, precision, and scale; entity and enum presentations refer to stable IDs.
9. Entity descriptors preserve nullability, generation, immutability, and snapshot metadata from the operation manifest.
10. Action forms and query tables preserve callable input order, result entity identity, query bounds, and declared typed errors.
11. Generated `typescript/ui.ts` is exported by the browser entry point, provides operation-ID-indexed input/results, and dispatches through the generated authenticated HTTP client.
12. An operation ID not emitted in the generated UI manifest fails closed as typed validation rather than reaching the network or database.
13. The UI manifest makes no authorization-visibility, entity-option-source, workflow-control, or framework-component claim.
14. The live Procurement API integration selects declared descriptors, executes their stable IDs through the UI executor and HTTP boundary, binds caller identity on the server, and preserves existing workflow and authorization semantics.
