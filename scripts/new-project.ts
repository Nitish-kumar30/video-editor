/**
 * Create a project from a video on your computer, without the UI.
 *
 *   npm run new -- "C:\Videos\my clip.mp4"
 *   npm run new -- ./clip.mov --name "Holiday reel"
 *
 * Copies the video into projects/<id>/source.<ext>, writes edits.json and makes the
 * timeline thumbnails (and a preview proxy for HEVC/ProRes videos).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createProjectDir, projectDir, writeEdits, PROJECTS_DIR } from "../lib/storage";
import { installSource } from "../lib/media";
import { getJob, type JobKind } from "../lib/jobs";

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf("--name");
  const name = nameIdx >= 0 ? args.splice(nameIdx, 2)[1] : undefined;
  const input = args[0];
  if (!input) {
    console.error('Usage: npm run new -- "<path to video>" [--name "Project name"]');
    process.exit(1);
  }
  const src = path.resolve(input);
  if (!fs.existsSync(src)) {
    console.error(`File not found: ${src}`);
    process.exit(1);
  }

  const id = await createProjectDir(name || path.basename(src));
  const dir = projectDir(id);
  console.log(`Creating project "${id}" in ${dir}`);
  const tmp = path.join(dir, ".tmp", "upload");
  await pipeline(fs.createReadStream(src), fs.createWriteStream(tmp)); // streamed: works for huge files
  try {
    const { edits, needsPreview } = await installSource(id, tmp, path.basename(src));
    if (name) await writeEdits(id, { ...edits, name });
    const s = edits.source;
    console.log(`Video: ${s.width}x${s.height}, ${s.duration}s, ${s.fps} fps, ${s.codec}, audio: ${s.hasAudio ? "yes" : "no"}`);
    await waitFor(id, "thumbs", "Thumbnails");
    if (needsPreview) await waitFor(id, "preview", "Browser preview (this codec needs a proxy)");
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw e;
  }
  console.log(`\nDone! Project id: ${id}`);
  console.log(`  Edit in the browser:  npm run dev  ->  http://localhost:3000/editor/${id}`);
  console.log(`  Edit by hand / AI:    ${path.relative(process.cwd(), path.join(PROJECTS_DIR, id, "edits.json"))}`);
  console.log(`  Render from CLI:      npm run render -- ${id}`);
}

async function waitFor(id: string, kind: JobKind, label: string) {
  for (;;) {
    const job = getJob(id, kind);
    if (!job) return;
    process.stdout.write(`\r${label}: ${job.progress.toFixed(0)}%   `);
    if (job.state !== "running") {
      process.stdout.write("\n");
      if (job.state === "error") console.warn(`  (${label} failed: ${job.error})`);
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : e);
  process.exit(1);
});
