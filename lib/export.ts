/**
 * Render a project to MP4 (server/CLI only). Both the Export button (API route) and
 * `npm run render` call renderProject(), so they always produce the same file.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { buildRender, type RenderOptions } from "./render";
import { runFfmpeg, hasFilter } from "./ffmpeg";
import { readEdits, projectDir, FONT_FILE } from "./storage";
import { sanitizeFilename, type Edits } from "./schema";

export interface ExportOptions {
  height?: Edits["export"]["height"];
  quality?: RenderOptions["quality"];
  filename?: string;
  onProgress?: (percent: number) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

/** Default export name: "<filename or project name>.mp4", never overwriting an older export. */
async function pickOutputName(dir: string, edits: Edits, wanted?: string): Promise<string> {
  const base = sanitizeFilename(wanted) || edits.export.filename || sanitizeFilename(edits.name) || "export";
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.mp4` : `${base} (${i}).mp4`;
    try {
      await fsp.access(path.join(dir, "exports", name));
    } catch {
      return name;
    }
  }
}

/** Renders the project and returns the output path relative to the project folder ("exports/x.mp4"). */
export async function renderProject(id: string, opts: ExportOptions = {}): Promise<string> {
  const dir = projectDir(id);
  const { edits } = await readEdits(id);
  await fsp.mkdir(path.join(dir, "exports"), { recursive: true });
  await fsp.mkdir(path.join(dir, ".tmp"), { recursive: true });

  const name = await pickOutputName(dir, edits, opts.filename);
  const partial = `.tmp/render-${Date.now()}.mp4`;
  const textEngine = (await hasFilter("drawtext")) ? "drawtext" : "ass";
  if (edits.texts.length && textEngine === "ass" && !(await hasFilter("ass"))) {
    throw new Error("This FFmpeg build can't draw text (no drawtext or ass filter). Set FFMPEG_PATH to a full FFmpeg build.");
  }
  const plan = buildRender(edits, { outputFile: partial, height: opts.height, quality: opts.quality, textEngine });

  for (const f of plan.files) await fsp.writeFile(path.join(dir, f.path), f.content, "utf8");
  if (plan.fontFile) await fsp.copyFile(FONT_FILE, path.join(dir, plan.fontFile));
  for (const img of edits.images) await mustExist(dir, img.file);
  if (edits.audio.music) await mustExist(dir, edits.audio.music.file);
  await mustExist(dir, edits.source.file);

  try {
    await runFfmpeg(plan.args, {
      cwd: dir,
      duration: plan.outputDuration,
      onProgress: opts.onProgress,
      onLog: opts.onLog,
      signal: opts.signal,
    });
  } catch (e) {
    await fsp.rm(path.join(dir, partial), { force: true });
    throw e;
  }
  await fsp.rename(path.join(dir, partial), path.join(dir, "exports", name));
  return `exports/${name}`;
}

async function mustExist(dir: string, rel: string) {
  try {
    await fsp.access(path.join(dir, rel));
  } catch {
    throw new Error(`Missing file in the project folder: ${rel}`);
  }
}
