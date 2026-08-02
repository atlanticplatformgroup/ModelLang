# ModelLang 0.24 conformance

An implementation conforms when it satisfies 0.23 conformance and:

1. parses at most one `recovery manual;` clause after consumer retry policy and before the effect;
2. rejects manual recovery without bounded retry;
3. preserves `none` or `manual` recovery policy in IR16 and trusted semantic manifest v8;
4. confines recovery execution to an isolated non-login role with no application, gateway, dispatcher, consumer, owner, or table privilege;
5. permits recovery only for current-policy opted-in durable `deadLetter` state and serializes it with handler execution and failure recording;
6. makes committed inbox success dominate recovery and returns `alreadyConsumed` without mutation;
7. atomically reopens terminal state as `ready`, resets only the current cycle count, increments a durable generation, and appends exact private recovery audit;
8. preserves monotonic total failure count and starts a later failure cycle at one;
9. rolls back state and audit together and never invokes a handler or mutates broker state during recovery;
10. generates typed server-only recovery adapters without widening public or agent-facing contracts;
11. classifies existing-consumer recovery-policy changes for reviewed acknowledgement and accepts IR9–IR15 baselines for IR16 current input; and
12. provides a baseline-checked idempotent `014_upgrade_0_24.sql` without fabricated recovery or execution history.
