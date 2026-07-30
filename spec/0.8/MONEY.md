# ModelLang 0.8 — Exact Money

Status: normative design contract for the 0.8 reference compiler.

## Money types

`Money<C>` is an exact, nominal value type for one built-in currency profile. The currency is part of the type:

```modellang
amount: Money<USD>;
```

`Money<USD>` and `Money<EUR>` are incompatible. Assignment, equality, and ordering require the same complete money type. There is no implicit currency conversion and no comparison between Money and `Int` or `Decimal`.

Version 0.8 has these closed built-in profiles:

| Currency | Precision | Scale |
|---|---:|---:|
| USD | 20 | 2 |
| EUR | 20 | 2 |
| GBP | 20 | 2 |
| JPY | 20 | 0 |
| KWD | 20 | 3 |

These identifiers are ModelLang nominal currency profiles. Version 0.8 does not claim a complete or dynamically updated currency registry.

Precision is the maximum total decimal digits and scale is the maximum fractional digits. A value must be a finite base-10 number, must not be PostgreSQL `NaN`, and must have absolute value less than `10^(precision - scale)`. Values are never silently rounded. Negative values are valid unless a field annotation, invariant, or action precondition forbids them.

## Literals and operations

A money literal has an explicit currency:

```modellang
USD 10000
USD 10.25
USD -5.00
```

The literal must fit the named currency profile at compile time. Version 0.8 permits same-currency `==`, `!=`, `<`, `<=`, `>`, and `>=`. Boolean composition and null checks follow the inherited expression rules.

Arithmetic, allocation, multiplication, division, percentages, conversion, exchange rates, formatting, and rounding are not defined in 0.8.

Numeric field annotations such as `@min`, `@minExclusive`, and `@max` apply in the field’s declared currency. For example, `Money<USD> @minExclusive(0)` excludes zero and negative USD values without changing their currency type.

## Canonical IR

IR version 8 records the complete profile in every money type reference:

```text
money:USD:20:2
```

Money literals preserve their source decimal text plus currency, precision, and scale. Backends therefore do not infer currency metadata from a field name, host locale, or floating-point value.

Each stored money field has a `money:<field-id>` enforcement requirement. Each callable money parameter has a `money-parameter:<parameter-id>` requirement.

## PostgreSQL representation

PostgreSQL stores money as exact `numeric`, not `real`, `double precision`, or PostgreSQL’s locale-sensitive `money` type. Named constraints reject `NaN`, excess scale, and values outside the profile range. Generated action and query functions validate callable money parameters before evaluating business guards.

Same-currency comparisons lower directly to exact numeric comparisons. Currency never arrives as a caller-controlled SQL argument because it is fixed by the generated function’s ModelLang signature.

## TypeScript representation

Generated clients expose:

```ts
interface Money<C extends string> {
  readonly currency: C;
  readonly amount: string;
}
```

The amount is a plain base-10 string. The client rejects a wrong runtime currency, exponent notation, separators, excess scale, and out-of-range integral digits before issuing SQL. PostgreSQL independently enforces the numeric profile.

Returned entities contain the currency and a fixed-scale exact amount string, for example:

```json
{ "currency": "USD", "amount": "5000.00" }
```
