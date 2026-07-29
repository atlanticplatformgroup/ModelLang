# ModelLang 0.2 conformance

The reference compiler is conformant when:

1. The 0.1 Procurement model compiles unchanged in behavior.
2. Entity equality lowers to primary-key identity equality.
3. Caller parameters cannot appear in callable SQL or TypeScript inputs.
4. Every successful output validates against IR version 2.
5. The Reservations model emits strict interval and half-open overlap constraints.
6. Invalid interval definitions fail compilation with stable diagnostics.
7. Invalid stored intervals fail at PostgreSQL.
8. Adjacent reservations succeed.
9. Overlapping reservations fail with generated `ConflictError`.
10. An overlapping concurrent insert is observed waiting on PostgreSQL and exactly one transaction succeeds.
11. Every declared and compiler-derived rule is present in the enforcement map.
12. Repeated compilation is byte-identical.
