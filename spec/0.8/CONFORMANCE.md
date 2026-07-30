# ModelLang 0.8 exact-money conformance

The 0.8 implementation is conformant when:

1. All 0.7 conformance tests continue to pass.
2. `Money<C>` resolves only for a declared 0.8 built-in profile.
3. Canonical IR version 8 preserves currency, precision, scale, and exact money-literal text.
4. Same-currency assignment and comparison compile while cross-currency and Money/numeric mixing fail.
5. Money literals with excess scale or range fail at compile time.
6. PostgreSQL uses exact `numeric` storage with named finite-value, scale, and range constraints.
7. Every callable money parameter is independently validated in its generated function.
8. Generated TypeScript uses `Money<"C">`, validates the runtime currency and decimal string, and never converts through a JavaScript number.
9. Returned money values include their fixed currency and exact fixed-scale amount string.
10. Enforcement output maps every stored money field and callable money parameter to an executable target.
11. Procurement uses `Money<USD>` for stored, input, threshold, invariant, and authorization semantics.
12. Unit and live PostgreSQL tests reject wrong currencies, excess fractional digits, malformed client strings, and invalid direct storage.
