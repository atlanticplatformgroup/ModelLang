# ModelLang 0.43 bounded delegated capabilities

## Purpose and authority

A delegated capability is a real but tightly attenuated authority grant for one exact declared action invocation. It is not discovery metadata, a task packet, a prompt, a subscription, a bearer replacement, or a general role assignment.

The generated boundary exposes issuance at `POST /agent/delegations`, revocation at `POST /agent/delegations/{grantId}/revoke`, HTTP invocation through the `delegated-capability` header, and MCP invocation through `_meta["dev.modellang/delegatedCapability"]`. Issuance and revocation are HTTP-only. MCP tool discovery describes the invocation convention but grants no authority.

## Issuance

Issuance requires ordinary bearer authentication for the grantor. Its closed request names:

- exactly one declared action ID and that action's exact closed input;
- one delegate identity as issuer and subject;
- one absolute audience URI; and
- a lifetime from one through 3,600 seconds.

The runtime validates the input and evaluates the action through the existing authenticated applicability path. Only an `applicable` result can be delegated. The grant binds the canonical SHA-256 of the exact input and the returned concurrency revision. Caller command metadata and an existing delegated credential are rejected, so a delegated caller cannot re-delegate.

The host-provided credential authority receives the exact action/input, input hash, delegate, audience, time bounds, and revision. It creates and stores an opaque secret and returns a UUID grant ID. The response delivers the secret once with `Cache-Control: no-store` and `Pragma: no-cache`. It contains the operation ID, input hash, revision, time bounds, audience, and fixed attenuation constraints, but omits the input, grantor identity, and delegate identity.

ModelLang does not prescribe signing, encryption, or credential storage. Those are host responsibilities. The generated contract requires an unpredictable 32-to-4,096-character opaque credential; conforming hosts must protect it as a secret.

## Invocation

Invocation requires both ordinary authenticated delegate context and the separate delegated credential. The authenticator supplies a delegate-bound credential runtime; the credential is never accepted as the bearer token and is never forwarded.

Before dispatch, the generated adapter requires the current delegated-capability schema, model ID/version/source hash, catalog version, valid UUID grant, declared action, exact audience, active time window, maximum one-hour lifetime, required revision, and fixed one-use/non-transferable/no-redelegation constraints. It validates the supplied action input and compares its canonical JSON SHA-256 to the grant. Caller-supplied revision, idempotency, correlation, and causation metadata are rejected. For reliable actions, the adapter derives stable command metadata from the grant ID.

The host credential authority must atomically recheck delegate binding, active/revoked/consumed state, claim equality, and current host policy; consume the one use; and execute through the stored grantor-bound executor. That execution continues through the normal ModelLang action boundary, which reloads state and enforces current authorization, preconditions, concurrency revision, workflow, invariants, locks, effects, evidence, and exact output validation. A failed or stale action does not become valid because a grant exists.

Only action execution accepts delegated credentials. Queries, query resources, applicability, subject views, task packets, issuance, and revocation reject them. Actions remain commands and resources remain non-authoritative observations.

## Revocation and replay

Revocation uses ordinary grantor authentication and a UUID grant ID. The host binds revocation authority to the stored grantor and returns one of `revoked`, `alreadyRevoked`, `consumed`, `expired`, or `notFound` without disclosing identities or the credential. Revocation responses are no-store.

Every grant has `uses: 1`. The host's atomic consume-and-execute boundary is authoritative for replay prevention, including concurrent invocations. Generated pre-dispatch validation is defense in depth and does not replace host atomicity.

## Non-claims

Delegated capability v1 does not implement transferable or multi-use grants, grant chains, re-delegation, consent workflows, approval packets, offline/macaroons-style attenuation, public decision traces, public grant enumeration, extension-backed tools, prompts, subscriptions, complete task closure, or full SML-Agent conformance.
