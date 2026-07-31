# ModelLang 0.13 — Framework-neutral UI manifest

Status: normative design contract for the 0.13 reference compiler.

## Purpose and boundary

ModelLang 0.13 generates enough deterministic metadata for an application to render basic action forms, query filters, and entity result tables without coupling ModelLang to a UI framework. The artifact is `ui.json`, validated by `schemas/ui-manifest.schema.json`, and accompanied by `typescript/ui.ts`.

The UI manifest is a consumer of operation manifest v1. It is not canonical IR, an enforcement backend, an authorization oracle, or a component tree. The derivation is:

```text
.model -> canonical IR9 -> operation manifest v1 -> UI manifest v1
                                                    -> typed UI executor -> HTTP client
```

PostgreSQL names, database roles, SQL types, connection details, and server identity adapters must not appear in the UI contract.

## Version and provenance

`uiManifestVersion` versions the UI document independently. Version 0.13 emits UI manifest version 1 and records `operationManifestVersion: 1`. The model ID, name, version, and source hash are copied from the operation manifest so a host can associate generated artifacts from the same compilation.

A consumer must reject an unsupported UI manifest version. Compatibility negotiation between independently deployed clients and servers remains host-owned.

## Stable bindings and generated labels

Durable entity, field, enum, enum-member, action, and query bindings use their stable semantic IDs. A renderer must use those IDs for durable configuration and operation dispatch. Declaration names remain generated code and data-property names.

Callable fields use the parameter identifier supplied by operation manifest v1. Parameters are not durable declarations in ModelLang 0.13: their identifier is scoped to the stable operation ID and current parameter name, so a parameter rename is a public operation-shape change. Hosts must not treat parameter identifiers as rename-stable declaration identity.

Every declaration also receives a default human-readable label derived deterministically from its current name: camel-case, acronym, underscore, and hyphen boundaries become spaces; the result is lower-cased and its first character capitalized. For example, `openRequest` becomes `Open request`, `RequestStatus` becomes `Request status`, and `APPROVED` becomes `Approved`.

Labels are presentation defaults, not semantic identity. A rename may change a label while leaving every stable ID unchanged. Localization, product copy, grouping, ordering overrides, and other host presentation policy are layered by stable ID outside `.model` source.

## Authentication

The manifest always declares:

```json
{ "required": true, "callerInput": false }
```

The authenticated caller parameter is excluded from every form and filter descriptor. A renderer or executor must never synthesize caller identity into operation input. The generated HTTP boundary and server bind caller identity from authenticated context exactly as in 0.11 and 0.12.

The presence of an operation in a UI manifest does not assert that the current caller is authorized to execute it. Authorization remains an enforced operation result and may produce the declared typed error.

## Presentation types

Operation parameters and entity fields map to these transport-neutral presentation discriminants:

| ModelLang value | UI presentation |
| --- | --- |
| `String` | `text` |
| `Int` | `integer` |
| `Decimal` | `decimal` |
| `Boolean` | `boolean` |
| `UUID` | `uuid` |
| `DateTime` | `dateTime` |
| entity reference | `entityReference` with `entityId` |
| enum | `enum` with `enumId` |
| enum set | `enumSet` with `enumId` |
| `Money<C>` | `money` with currency, precision, and scale |

These values describe data presentation and collection. They do not mandate a particular HTML element, validation library, date picker, money input, or accessibility implementation. Transport validation remains authoritative even when a renderer performs earlier client-side validation.

## Enum and entity descriptors

Each enum descriptor contains its stable ID, name, default label, and all declared options. Each option contains its enum-member stable ID, stored transport value, and default label.

Each entity descriptor contains its stable ID, name, default label, and ordered fields. A field contains its stable field ID, name, default label, presentation type, nullability, generated strategy when present, immutability, and snapshot status. These facts support result-table and detail-view rendering; they do not authorize a query or mutation.

Generated and immutable flags describe model ownership and mutability. Snapshot means stored point-in-time data and does not imply live relationship traversal.

## Action forms and query tables

Each action descriptor contains:

- its stable operation ID, name, and default label;
- an ordered `fields` array derived from callable parameters only;
- the stable result entity ID; and
- the typed error kinds declared by the operation manifest.

Each query descriptor contains:

- its stable operation ID, name, and default label;
- an ordered `filters` array derived from callable parameters only;
- the stable result entity ID and declared maximum result count; and
- the typed error kinds declared by the operation manifest.

All callable parameters in UI manifest v1 have `required: true`, matching the current ModelLang operation grammar and closed HTTP request schemas. Empty operation input is represented by an empty field or filter array and an empty request object.

Entity-reference presentation identifies the referenced entity type but does not provide an option source. A host may offer only values it obtains through an independently declared and authorized operation or trusted host data. The compiler must not invent direct entity reads.

## Browser-safe TypeScript executor

`typescript/ui.ts` embeds the same UI manifest as a readonly constant and exports operation-ID-indexed input and result maps. `create<Model>UiExecutor` accepts the generated browser HTTP client and dispatches only the stable operation IDs emitted in the manifest. Unknown IDs fail closed as a typed `ValidationError` with code `ML_UI_OPERATION_NOT_FOUND` and rule ID `ui:operation`.

The executor adds no alternate transport, authorization, mutation, or data-access surface. Input and output validation, caller binding, typed transport errors, and PostgreSQL enforcement remain on the existing generated path.

`typescript/browser.ts` exports the UI descriptors and executor. It remains free of Node.js, SQL, PostgreSQL, and server-only gateway contracts.

## Deliberate scope

Version 0.13 does not generate framework components, HTML, CSS, layout, routing, navigation, relationship option queries, authorization-based visibility, workflow buttons, optimistic updates, pagination controls, localization bundles, accessibility policy, or client-side validation code.

Workflows remain available through the existing browser-safe workflow metadata but are not folded into UI manifest v1. Doing so safely requires explicit operation-manifest workflow semantics rather than inference from unrelated generated artifacts.
