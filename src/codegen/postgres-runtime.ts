export interface PostgresRuntimeProfile {
  readonly runtimeVersion: number;
  readonly applicability: boolean;
  readonly failureObservation: boolean;
  readonly failureAcknowledgement: boolean;
  readonly failureClaim: boolean;
}

export const POSTGRES_RUNTIME_PROFILES = {
  legacy: {
    runtimeVersion: 0,
    applicability: false,
    failureObservation: false,
    failureAcknowledgement: false,
    failureClaim: false,
  },
  applicability: {
    runtimeVersion: 17,
    applicability: true,
    failureObservation: false,
    failureAcknowledgement: false,
    failureClaim: false,
  },
  failureObservation: {
    runtimeVersion: 27,
    applicability: true,
    failureObservation: true,
    failureAcknowledgement: false,
    failureClaim: false,
  },
  failureAcknowledgement: {
    runtimeVersion: 28,
    applicability: true,
    failureObservation: true,
    failureAcknowledgement: true,
    failureClaim: false,
  },
  current: {
    runtimeVersion: 29,
    applicability: true,
    failureObservation: true,
    failureAcknowledgement: true,
    failureClaim: true,
  },
} as const satisfies Record<string, PostgresRuntimeProfile>;

type OperationalRole =
  | "modellang_gateway"
  | "modellang_dispatcher"
  | "modellang_consumer"
  | "modellang_recovery"
  | "modellang_publication_recovery"
  | "modellang_failure_observer"
  | "modellang_failure_acknowledger"
  | "modellang_failure_claimant";

interface OperationalRoleDefinition {
  readonly role: OperationalRole;
  readonly isolatedFrom: readonly string[];
}

const OPERATIONAL_ROLE_DEFINITIONS = {
  gateway: {
    role: "modellang_gateway",
    isolatedFrom: ["modellang_owner"],
  },
  dispatcher: {
    role: "modellang_dispatcher",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway"],
  },
  consumer: {
    role: "modellang_consumer",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway", "modellang_dispatcher"],
  },
  recovery: {
    role: "modellang_recovery",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway", "modellang_dispatcher", "modellang_consumer"],
  },
  publicationRecovery: {
    role: "modellang_publication_recovery",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway", "modellang_dispatcher", "modellang_consumer", "modellang_recovery"],
  },
  failureObserver: {
    role: "modellang_failure_observer",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway", "modellang_dispatcher", "modellang_consumer", "modellang_recovery", "modellang_publication_recovery"],
  },
  failureAcknowledger: {
    role: "modellang_failure_acknowledger",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway", "modellang_dispatcher", "modellang_consumer", "modellang_recovery", "modellang_publication_recovery", "modellang_failure_observer"],
  },
  failureClaimant: {
    role: "modellang_failure_claimant",
    isolatedFrom: ["modellang_owner", "modellang_app", "modellang_gateway", "modellang_dispatcher", "modellang_consumer", "modellang_recovery", "modellang_publication_recovery", "modellang_failure_observer", "modellang_failure_acknowledger"],
  },
} as const satisfies Record<string, OperationalRoleDefinition>;

function generateIsolatedRoleStatements(definition: OperationalRoleDefinition): string {
  const { role, isolatedFrom } = definition;
  const peers = isolatedFrom.join(", ");
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE ${peers} FROM ${role};
REVOKE ${role} FROM ${peers};`;
}

export function generateGatewayRoleStatements(): string {
  const { role } = OPERATIONAL_ROLE_DEFINITIONS.gateway;
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner FROM ${role};
REVOKE ${role} FROM modellang_app;
GRANT modellang_app TO ${role};`;
}

export function generateDispatcherRoleStatements(): string {
  return generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.dispatcher);
}

export function generateConsumerRoleStatements(): string {
  return generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.consumer);
}

export function generateRecoveryRoleStatements(): string {
  return `${generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.recovery)}

${generatePublicationRecoveryRoleStatements()}`;
}

export function generatePublicationRecoveryRoleStatements(): string {
  return generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.publicationRecovery);
}

export function generateFailureObserverRoleStatements(): string {
  return generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.failureObserver);
}

export function generateFailureAcknowledgerRoleStatements(): string {
  return generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.failureAcknowledger);
}

export function generateFailureClaimantRoleStatements(): string {
  return generateIsolatedRoleStatements(OPERATIONAL_ROLE_DEFINITIONS.failureClaimant);
}
