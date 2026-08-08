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

export type RoleMembership = readonly [grantedRole: string, memberRole: string];

/**
 * PostgreSQL warns when REVOKE targets a membership that does not exist. The
 * generated boundary intentionally revokes defensive role pairs on clean and
 * existing databases, so select only memberships that are actually present.
 * Errors from catalog access or the REVOKE itself remain visible.
 */
export function generateConditionalRoleRevokes(memberships: readonly RoleMembership[]): string {
  if (memberships.length === 0) return "";
  const values = memberships
    .map(([grantedRole, memberRole]) => `('${grantedRole.replaceAll("'", "''")}', '${memberRole.replaceAll("'", "''")}')`)
    .join(",\n      ");
  return `DO $modellang$
DECLARE
  v_granted_role text;
  v_member_role text;
BEGIN
  FOR v_granted_role, v_member_role IN
    SELECT granted_role.rolname::text, member_role.rolname::text
    FROM (VALUES
      ${values}
    ) AS candidate(granted_role, member_role)
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.rolname = candidate.granted_role
    JOIN pg_catalog.pg_roles AS member_role ON member_role.rolname = candidate.member_role
    JOIN pg_catalog.pg_auth_members AS membership
      ON membership.roleid = granted_role.oid AND membership.member = member_role.oid
  LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', v_granted_role, v_member_role);
  END LOOP;
END
$modellang$;`;
}

export function generateBoundaryRoleRevokes(): string {
  const memberships: RoleMembership[] = [
    ["modellang_owner", "modellang_app"],
    ["modellang_owner", OPERATIONAL_ROLE_DEFINITIONS.gateway.role],
    [OPERATIONAL_ROLE_DEFINITIONS.gateway.role, "modellang_app"],
  ];
  for (const definition of Object.values(OPERATIONAL_ROLE_DEFINITIONS)) {
    if (definition.role === OPERATIONAL_ROLE_DEFINITIONS.gateway.role) continue;
    memberships.push(
      ...definition.isolatedFrom.map((peer) => [peer, definition.role] as const),
      ...definition.isolatedFrom.map((peer) => [definition.role, peer] as const),
    );
  }
  return generateConditionalRoleRevokes(memberships);
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
  const revocations: RoleMembership[] = [
    ...isolatedFrom.map((peer) => [peer, role] as const),
    ...isolatedFrom.map((peer) => [role, peer] as const),
  ];
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
${generateConditionalRoleRevokes(revocations)}`;
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
${generateConditionalRoleRevokes([
    ["modellang_owner", role],
    [role, "modellang_app"],
  ])}
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
