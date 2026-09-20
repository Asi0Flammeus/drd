/** `npm run migrate` — apply pending migrations and say what happened. */

import { accessSync, constants, mkdirSync } from "node:fs";
import { config } from "../server/config.ts";
import { closeDb, migrate } from "../server/db.ts";

try {
  mkdirSync(config.mediaDir, { recursive: true });
  accessSync(config.dataDir, constants.W_OK);
} catch {
  // In a container with a bind-mounted data directory this is the first thing
  // that goes wrong, and SQLite's own message ("attempt to write a readonly
  // database") names neither the directory nor the cause.
  console.error(
    `DRD_DATA_DIR is not writable: ${config.dataDir}\n` +
      `Running as uid ${process.getuid?.() ?? "?"}, gid ${process.getgid?.() ?? "?"}.\n` +
      `In Docker, run the container as the uid that owns the mounted directory ` +
      `(DRD_UID / DRD_GID in docker-compose.yml) or chown it to the image user.`,
  );
  process.exit(1);
}

const result = migrate();
console.log(
  result.applied.length
    ? `applied ${result.applied.join(", ")} — schema now at ${result.current} (${config.dbPath})`
    : `nothing to apply — schema already at ${result.current} (${config.dbPath})`,
);
closeDb();
