/**
 * Render a project to MP4 without the UI. Produces exactly what the Export button does.
 *
 *   npm run render -- <projectId>
 *   npm run render -- <projectId> --height 720 --quality medium --name "final cut"
 *   npm run render -- <projectId> --print     (only print the FFmpeg command, don't render)
 */
import path from "node:path";
import { renderProject } from "../lib/export";
import { readEdits, projectDir, listProjects } from "../lib/storage";
import { buildRender } from "../lib/render";
import { hasFilter } from "../lib/ffmpeg";
import { formatTime, type ExportHeight, type Quality } from "../lib/schema";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const valueFlags = ["--height", "--quality", "--name"];
  const id = args.find((a, i) => !a.startsWith("--") && !valueFlags.includes(args[i - 1]));
  if (!id) {
    console.error("Usage: npm run render -- <projectId> [--height 1080|720|480] [--quality high|medium|small] [--name file] [--print]");
    const projects = await listProjects();
    if (projects.length) console.error("\nProjects:\n" + projects.map((p) => `  ${p.id}`).join("\n"));
    process.exit(1);
  }
  const h = flag(args, "--height");
  const height = h === undefined ? undefined : h === "original" || h === "null" ? null : (Number(h) as ExportHeight);
  const quality = flag(args, "--quality") as Quality | undefined;
  const filename = flag(args, "--name");

  const { edits } = await readEdits(id);
  const textEngine = (await hasFilter("drawtext")) ? "drawtext" : "ass";
  const plan = buildRender(edits, { outputFile: "out.mp4", height, quality, textEngine });
  console.log(`Project ${id}: ${plan.segments.length} segment(s), output ${formatTime(plan.outputDuration)} at ${plan.outWidth}x${plan.outHeight}`);

  if (args.includes("--print")) {
    console.log("\nffmpeg " + plan.args.map((a) => (/[\s;'\[\]]/.test(a) ? JSON.stringify(a) : a)).join(" "));
    return;
  }

  const started = Date.now();
  const out = await renderProject(id, {
    height,
    quality,
    filename,
    onProgress: (p) => process.stdout.write(`\rRendering... ${p.toFixed(1)}%   `),
  });
  process.stdout.write("\n");
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${path.join(projectDir(id), out)}`);
}

main().catch((e) => {
  console.error("\nRender failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
