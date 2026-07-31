# ModelLang 0.10 safe-evolution conformance

The 0.10 implementation is conformant when:

1. All 0.9 language and workflow tests continue to pass.
2. Canonical IR remains version 9 and released 0.9 IR is accepted as a migration baseline.
3. Fresh installations record model ID, version, and source hash in an inaccessible internal history table.
4. Migration planning requires complete stable IDs and a new model version.
5. Enum/member, entity, safe-field, action, query, workflow, and transition additions are identified by stable ID.
6. Required fields without defaults/generation and data-dependent unique additions fail before SQL generation.
7. Existing declaration removals and semantic changes fail closed.
8. New tables precede their cross-entity foreign keys.
9. Added enum members refresh all affected existing scalar/set constraints.
10. Added workflow transitions replace the trigger function without recreating existing triggers.
11. Current action functions, query functions, and grants are redeployed transactionally.
12. The installed baseline must exactly match the previous IR history record.
13. A successful migration records the target source hash; a repeated or out-of-order migration is rejected.
14. Existing rows, foreign keys, action audit identity, and workflow enforcement survive a live additive migration.
15. Rename-only migrations remain supported under the new guarded transaction.
