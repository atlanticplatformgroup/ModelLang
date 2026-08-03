# ModelLang 0.37 conformance

An implementation conforms when it satisfies 0.36 conformance and:

1. parses the closed ordered extension syntax and assigns or preserves `ext_` stable identity;
2. resolves supported typed parameters/results, declared entity reads/writes, and locally owned emitted events;
3. rejects duplicate parameters/effects, unknown targets or declarations, imported emissions, empty governance obligations, unsafe retry, and unauthenticated state-changing extensions;
4. lowers extensions to IR26 with `execution: externalDeclarationOnly` and never creates a generated callable or authority path;
5. emits schema-valid extension ledger v1 with exact contracts, effects, governance, source spans, and zero generated implementations;
6. emits schema-valid target capability profile v1 with model requirements, native support, external gaps, and `authority: none`;
7. omits extension identities and implementation locations from public operation, capability, OpenAPI, and UI artifacts and from generated SQL and clients;
8. includes both assurance artifacts in deterministic provenance v2 with target profile identity and content hashes;
9. includes extensions in engineering semantic manifest v18 and source-linked enforcement evidence;
10. classifies extension additions, removals, renames, contract, behavior, and governance changes through semantic diff v19;
11. normalizes IR9 through IR25 to no declared extensions without fabricating historical obligations;
12. retains operation manifest v11, capability manifest v10, UI manifest v11, decision plan v2, event manifest v5, event envelope v2, HTTP routes, and PostgreSQL runtime profile 36; and
13. emits compiler 0.37.0, IR26, semantic profile v18, semantic diff v19, provenance v2, target profile v1, ledger v1, and generator profile `/21` deterministically.
