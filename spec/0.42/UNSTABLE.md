# ModelLang 0.42 unstable boundaries

The following remain outside the stable 0.42 contract:

- authored task goals, automatic observation selection, relevance proof, dependency graphs, multi-step plans, task state, scheduling, retries, and completion tracking;
- full state-write and external-effect summaries, reversibility, compensation, recovery instructions, and complete task closure;
- atomic multi-observation snapshots, as-of reads, commit timestamps, nonzero cache lifetimes, ETags, validators, and frozen packets;
- delegated capabilities, scoped authority tokens, consent, approval packets, transfer, attenuation, revocation, and signed grants;
- public decision traces, private-evidence observation, command receipts, evidence hashes, and disclosure of authenticated identity;
- stateful MCP sessions, MCP Tasks, resource templates, `resources/read`, subscriptions, prompts, elicitation, sampling, and server notifications;
- extension-backed agent tools, adversarial agent evaluation, complete SML-Agent conformance, and SML-Federation conformance.

Future work may add these only through explicit versioned contracts. A task packet, applicability decision, resource, tool definition, or authenticated session must never be interpreted as delegated authority.
