/**
 * Make a short test project without needing a real video:
 *
 *   npm run sample            -> 20 s test pattern with a beep, project id "sample"
 *   npm run sample -- 8       -> 8 s long
 *
 * Handy for trying the editor, or for checking a render change quickly:
 *   npm run sample && npm run render -- sample
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { createProjectDir, projectDir } from "../lib/storage";
import { installSource } from "../lib/media";
import { runFfmpeg } from "../lib/ffmpeg";
import { getJob } from "../lib/jobs";

async function main() {
  const seconds = Math.max(1, Math.min(600, Number(process.argv[2]) || 20));
  const id = await createProjectDir("sample");
  const dir = projectDir(id);
  const tmp = path.join(dir, ".tmp", "sample.mp4");
  await runFfmpeg(
    [
      "-y",
      "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      tmp,
    ],
    { cwd: dir },
  );
  await installSource(id, tmp, "sample.mp4");
  while (getJob(id, "thumbs")?.state === "running") await new Promise((r) => setTimeout(r, 200));
  await fsp.rm(tmp, { force: true });
  console.log(`Created project "${id}" (${seconds} s test pattern).`);
  console.log(`  Open:   http://localhost:3000/editor/${id}   (after npm run dev)`);
  console.log(`  Edit:   projects/${id}/edits.json`);
  console.log(`  Render: npm run render -- ${id}`);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
