import type { IRExpression, ModelIR } from "./ir.js";
import { MODELLANG_COMPILER_VERSION } from "./version.js";

export interface DecisionRule {
  id: string;
  expression: IRExpression;
}

export interface DecisionEntityLoad {
  parameterId: string;
  entityId: string;
  source: "authenticatedContext" | "operationInput";
  executionLock: "share" | "update";
  order: number;
}

export interface ActionDecisionPlan {
  operationId: string;
  callableParameterIds: string[];
  callerParameterId: string;
  entityLoads: DecisionEntityLoad[];
  authorization: DecisionRule;
  preconditions: DecisionRule[];
  revision: {
    ruleId: string;
    algorithm: "authoritativeRowVersion/1";
    componentParameterIds: string[];
    grantsAuthority: false;
  };
  absenceProjection: {
    outcome: "denied";
    explanationRuleId: string;
  };
}

export interface DecisionPlan {
  $schema: "https://modellang.dev/schemas/decision-plan.schema.json";
  planVersion: 1;
  audience: "enforcement";
  public: false;
  compilerVersion: string;
  irVersion: 9;
  model: { id: string; version: string; sourceHash: string };
  actions: ActionDecisionPlan[];
}

export function decisionRevisionRuleId(actionId: string): string {
  return `revision:${actionId}`;
}

export function decisionFunctionName(actionId: string): string {
  const stable = actionId.slice(actionId.indexOf(":") + 1).replace(/[^a-zA-Z0-9_]/g, "_");
  return `decide_${stable}`;
}

export function generateDecisionPlan(ir: ModelIR): DecisionPlan {
  return {
    $schema: "https://modellang.dev/schemas/decision-plan.schema.json",
    planVersion: 1,
    audience: "enforcement",
    public: false,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    irVersion: ir.irVersion,
    model: { id: ir.model.id, version: ir.model.version, sourceHash: ir.model.sourceHash },
    actions: ir.actions.map((action) => {
      const locks = new Map(action.lockPlan.map((lock) => [lock.parameterId, lock.mode]));
      const entityLoads = action.parameters
        .filter((parameter) => parameter.type.startsWith("entity:"))
        .map((parameter, index): DecisionEntityLoad => ({
          parameterId: parameter.id,
          entityId: parameter.type,
          source: parameter.caller ? "authenticatedContext" : "operationInput",
          executionLock: locks.get(parameter.id) ?? "share",
          order: action.lockPlan.find((lock) => lock.parameterId === parameter.id)?.order ?? index,
        })).sort((left, right) => left.order - right.order || left.parameterId.localeCompare(right.parameterId));
      return {
        operationId: action.id,
        callableParameterIds: [...action.callableParameters],
        callerParameterId: action.callerParameterId,
        entityLoads,
        authorization: { id: action.authorization.id, expression: action.authorization.expression },
        preconditions: action.preconditions.map((rule) => ({ id: rule.id, expression: rule.expression })),
        revision: {
          ruleId: decisionRevisionRuleId(action.id),
          algorithm: "authoritativeRowVersion/1",
          componentParameterIds: action.parameters.map((parameter) => parameter.id),
          grantsAuthority: false,
        },
        absenceProjection: {
          outcome: "denied",
          explanationRuleId: action.authorization.id,
        },
      };
    }),
  };
}

export function decisionAction(plan: DecisionPlan, actionId: string): ActionDecisionPlan {
  const result = plan.actions.find((action) => action.operationId === actionId);
  if (!result) throw new Error(`E6401 Missing decision plan for action '${actionId}'.`);
  return result;
}
