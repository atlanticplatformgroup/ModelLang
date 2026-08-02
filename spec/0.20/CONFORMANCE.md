# ModelLang 0.20 conformance

An implementation conforms when it satisfies 0.19 conformance and:

1. parses stable typed event declarations and post-effect emission clauses;
2. rejects unknown, duplicate-per-action, non-entity, or payload-mismatched events;
3. preserves declarations and ordered emissions in canonical IR12;
4. commits events atomically with state, audit, evidence, and receipts;
5. creates no event on rollback or reliable-command replay;
6. keeps outbox rows inaccessible to application and gateway roles;
7. provides bounded private lease/ack/release delivery with at-least-once semantics;
8. emits schema-valid event manifest v1 and typed event envelopes;
9. detects event and emission evolution by stable identity; and
10. provides a baseline-checked, idempotent 0.20 administrative upgrade.
