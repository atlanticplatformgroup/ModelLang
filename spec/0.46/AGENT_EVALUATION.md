# ModelLang 0.46 agent evaluation contract

## Conditions and scenarios

Agent evaluation suite v1 uses the four comparison conditions defined by the whitepaper:

1. source code and ordinary documentation;
2. transport schemas plus prose;
3. integrated specifications linked by stable identity; and
4. an authorization-aware semantic package.

The initial Procurement corpus is bound to an exact model source hash, catalog version, and MCP adapter version. It tests missing-fact recognition, legal lifecycle planning, read-versus-command selection, stale recovery, self-approval avoidance, and host-extension boundary calibration. Scenarios declare required, allowed, and prohibited tool identities; required facts; expected effects; and whether the agent must recognize missing information. Replays must bind the same model snapshot.

## Driver and replay boundary

The TypeScript driver interface is provider-neutral. A caller supplies one context package for every condition and a driver that returns observations bound to the requested condition and scenario. Model names, prompts, credentials, network access, sampling policy, repetition count, and cost remain runner concerns.

Replay v1 records selected tools, unauthorized attempts, unnecessary reads, policy violations, completion, missing-fact calibration, predicted effects, and optional token and latency values. Replays reject unknown, duplicate, misbound, or incomplete observations.

## Scoring and interpretation

Scoring is deterministic and reports valid-plan rate, tool-selection accuracy, effect-prediction accuracy, calibration, unauthorized attempts, unnecessary reads, policy violations, tokens, and latency per condition.

The committed scoring fixture is synthetic, has `empiricalClaim: false`, and exists only to test schemas and scoring. Its values are not evidence that any model achieved those results. The scorer likewise emits `empirical: false` and `scoringOnlyNoModelQualityClaim`. A real experiment requires controlled external execution, recorded runner configuration, repeated trials, statistical analysis, and comparison against the integrated-specification condition; none is claimed by 0.46.
