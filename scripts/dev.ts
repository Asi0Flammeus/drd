/**
 * `npm run dev` — the API server and the Vite dev server, one terminal.
 *
 * Vite proxies /api and /media to the server, so the client runs at
 * http://127.0.0.1:5177 with live reload while captures happen on 5178. The
 * `drd.example/{url}` splat route only exists on the server port.
 */

import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/main.ts"], { stdio: "inherit" }),
  spawn("npx", ["vite"], { stdio: "inherit", shell: process.platform === "win32" }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
