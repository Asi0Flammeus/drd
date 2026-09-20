/** `npm run migrate` — apply pending migrations and say what happened. */

import { mkdirSync } from "node:fs";
import { config } from "../server/config.ts";
import { closeDb, migrate } from "../server/db.ts";

mkdirSync(config.mediaDir, { recursive: true });
const result = migrate();
console.log(
  result.applied.length
    ? `applied ${result.applied.join(", ")} — schema now at ${result.current} (${config.dbPath})`
    : `nothing to apply — schema already at ${result.current} (${config.dbPath})`,
);
closeDb();
