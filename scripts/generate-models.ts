import { resolve } from "node:path";
import { compileFile } from "../src/compiler.js";
import { writeGeneratedModelsAtomically } from "../src/build.js";

async function main(): Promise<void> {
  const procurement = await compileFile(resolve("examples/procurement.model"));
  const reservations = await compileFile(resolve("examples/reservations.model"));
  await writeGeneratedModelsAtomically(
    { procurement, reservations },
    resolve("generated"),
    {
      procurement: { agentPlugin: { endpointUrl: "https://procurement.example.com/mcp" } },
      reservations: { agentPlugin: { endpointUrl: "https://reservations.example.com/mcp" } },
    },
  );
  process.stdout.write("Generated Procurement and Reservations into generated/.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
