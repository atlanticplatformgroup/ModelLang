import { installDemoDatabase } from "./database.js";

installDemoDatabase()
  .then(() => process.stdout.write("Applied generated SQL and provisioned local demo identities.\n"))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
