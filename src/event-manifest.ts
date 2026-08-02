import type { ModelIR } from "./ir.js";

export interface EventManifest {
  $schema: "https://modellang.dev/schemas/event-manifest.schema.json";
  eventManifestVersion: 2;
  model: { id: string; name: string; version: string; sourceHash: string };
  delivery: { semantics: "atLeastOnce"; storage: "privateTransactionalOutbox"; ordering: "occurredAtThenActionOrdinal"; acknowledgement: "leaseToken" };
  events: {
    id: string;
    name: string;
    payloadEntityId: string;
    source: ModelIR["events"][number]["source"];
    emittedByActionIds: string[];
  }[];
}

export function generateEventManifest(ir: ModelIR): EventManifest {
  return {
    $schema: "https://modellang.dev/schemas/event-manifest.schema.json",
    eventManifestVersion: 2,
    model: { id: ir.model.id, name: ir.model.name, version: ir.model.version, sourceHash: ir.model.sourceHash },
    delivery: { semantics: "atLeastOnce", storage: "privateTransactionalOutbox", ordering: "occurredAtThenActionOrdinal", acknowledgement: "leaseToken" },
    events: ir.events.map((event) => ({
      id: event.id,
      name: event.name,
      payloadEntityId: event.payloadEntityId,
      source: event.source,
      emittedByActionIds: ir.actions.filter((action) => action.emittedEventIds.includes(event.id)).map((action) => action.id),
    })),
  };
}
