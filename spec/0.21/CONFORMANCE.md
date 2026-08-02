# ModelLang 0.21 conformance

An implementation conforms when it satisfies 0.20 conformance and:

1. parses stable consumers and exact imported event source contracts;
2. rejects unknown events, payload mismatches, imported-event emission, invalid consumer effects, and workflow bypass;
3. preserves source contract, consumer identity, typed payload, rules, effect, locks, and duplicate semantics in IR13;
4. strictly validates the closed event envelope and complete typed payload before mutation;
5. keys the private inbox by stable consumer ID plus source event instance ID and fingerprints all stable envelope content;
6. serializes concurrent duplicates and commits exactly one local effect, audit/evidence row, inbox completion, and stored result;
7. replays an equivalent committed result without another handler evaluation or effect and rejects conflicting reuse without result disclosure;
8. rolls back the inbox claim, effect, evidence, and result on every failed or externally rolled-back attempt;
9. confines inboxes, payloads, fingerprints, results, and failure metadata to execute-only consumer infrastructure;
10. generates typed broker-neutral TypeScript consumer adapters without prescribing a broker;
11. excludes consumer instances and private state from operation, capability, UI, HTTP, and agent-facing contracts;
12. classifies consumer evolution by stable identity and accepts IR9–IR12 released baselines for IR13 current input; and
13. provides a baseline-checked idempotent `011_upgrade_0_21.sql` without historical consumption.
