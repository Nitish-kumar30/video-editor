// Starts Next.js with telemetry turned off (works the same on Windows, macOS and Linux).
// Used by `npm run dev`, `npm run build` and `npm run start`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
