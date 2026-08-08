import type { ModelIR } from "./ir.js";

export interface EventManifest {
  $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/event-manifest.schema.json";
  eventManifestVersion: 5;
  model: { id: string; name: string; version: string; sourceHash: string };
  delivery: { semantics: "atLeastOnce"; storage: "privateTransactionalOutbox"; ordering: "occurredAtThenProducerOrdinal"; acknowledgement: "leaseToken"; envelopeVersion: 2 };
  events: {
    id: string;
    name: string;
    payloadEntityId: string;
    source: ModelIR["events"][number]["source"];
    publicationFailurePolicy: ModelIR["events"][number]["publicationFailurePolicy"];
    emittedByActionIds: string[];
    emittedByConsumerIds: string[];
  }[];
}

export function generateEventManifest(ir: ModelIR): EventManifest {
  return {
    $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/event-manifest.schema.json",
    eventManifestVersion: 5,
    model: { id: ir.model.id, name: ir.model.name, version: ir.model.version, sourceHash: ir.model.sourceHash },
    delivery: { semantics: "atLeastOnce", storage: "privateTransactionalOutbox", ordering: "occurredAtThenProducerOrdinal", acknowledgement: "leaseToken", envelopeVersion: 2 },
    events: ir.events.map((event) => ({
      id: event.id,
      name: event.name,
      payloadEntityId: event.payloadEntityId,
      source: event.source,
      publicationFailurePolicy: event.publicationFailurePolicy,
      emittedByActionIds: ir.actions.filter((action) => action.emittedEventIds.includes(event.id)).map((action) => action.id),
      emittedByConsumerIds: ir.consumers.filter((consumer) => consumer.emittedEventIds.includes(event.id)).map((consumer) => consumer.id),
    })),
  };
}
