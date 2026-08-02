# ModelLang 0.22 conformance

An implementation conforms when it satisfies 0.21 conformance and:

1. parses ordered consumer `emit` clauses after the consumer effect;
2. rejects unknown, duplicate, imported, payload-incompatible, or cyclic consumer emissions;
3. preserves ordered consumer emitted-event IDs in IR14 and trusted semantic/event manifests;
4. represents action and consumer event producers distinctly and requires exactly one producer identity;
5. emits envelope v2 while normalizing released v1 action envelopes for duplicate identity and fingerprinting;
6. inherits correlation and sets downstream causation to the consumed source event instance ID;
7. commits consumer effect, audit/evidence, ordered downstream outbox rows, inbox completion, and stored result atomically;
8. emits no downstream event during committed duplicate replay or any failed/rolled-back attempt;
9. preserves outbox/inbox privacy and adds no consumer operation to public capability, UI, HTTP, or agent-facing contracts;
10. classifies consumer-emission evolution by stable identity and accepts IR9–IR13 released baselines for IR14 current input; and
11. provides a baseline-checked idempotent `012_upgrade_0_22.sql` without historical emission or fabricated evidence.
