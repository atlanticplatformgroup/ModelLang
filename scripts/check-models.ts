import { resolve } from "node:path";
import { compileFile } from "../src/compiler.js";

async function main(): Promise<void> {
  const files = ["examples/procurement.model", "examples/reservations.model"];
  for (const file of files) {
    const ir = await compileFile(resolve(file));
    process.stdout.write(`OK ${ir.model.name} ${ir.model.version} (${ir.entities.length} entities, ${ir.events.length} events, ${ir.consumers.length} consumers, ${ir.actions.length} actions, ${ir.queries.length} queries, ${ir.workflows.length} workflows, ${ir.extensions.length} extensions)\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
