/**
 * Setting up a project's source video (server/CLI only): probe it, write a default
 * edits.json, and make the timeline thumbnail strip and (if needed) a preview proxy.
 * Used by the upload API route and by `npm run new`.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { probe, runFfmpeg, isBrowserPlayable, type ProbeResult } from "./ffmpeg";
import { defaultEdits, type Edits } from "./schema";
import { projectDir, writeEdits } from "./storage";
import { startJob, getJob, type Job } from "./jobs";

export const THUMB_COUNT = 30;
export const THUMB_HEIGHT = 90;

/** Pick "source.<ext>" from an uploaded file name. */
export function sourceFileName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return "source" + (ext && ext.length <= 6 ? ext : ".mp4");
}

/**
 * Move an already-written temp file into place as the project's source, probe it and
 * write a fresh edits.json. Starts thumbnail + preview jobs in the background.
 */
export async function installSource(
  id: string,
  tempFile: string,
  originalName: string,
): Promise<{ edits: Edits; probe: ProbeResult; needsPreview: boolean }> {
  const dir = projectDir(id);
  // remove an older source (re-upload replaces it)
  for (const f of await fsp.readdir(dir)) {
    if (/^source\.[a-z0-9]+$/i.test(f) || f === "preview.mp4" || f === "thumbs.jpg") await fsp.rm(path.join(dir, f), { force: true });
  }
  const file = sourceFileName(originalName);
  await fsp.rename(tempFile, path.join(dir, file));
  let info: ProbeResult;
  try {
    info = await probe(file, dir);
  } catch (e) {
    await fsp.rm(path.join(dir, file), { force: true });
    throw e;
  }
  if (!(info.duration > 0) || !info.width || !info.height) {
    await fsp.rm(path.join(dir, file), { force: true });
    throw new Error("Could not read the video's duration or size. Is this a video file?");
  }
  const name = path.basename(originalName, path.extname(originalName));
  const { edits } = await writeEdits(
    id,
    defaultEdits(
      {
        file,
        width: info.width,
        height: info.height,
        duration: info.duration,
        fps: info.fps,
        hasAudio: info.hasAudio,
        codec: info.codec,
      },
      name,
    ),
  );
  const needsPreview = !isBrowserPlayable(info);
  startThumbsJob(id, edits);
  if (needsPreview) startPreviewJob(id, edits);
  return { edits, probe: info, needsPreview };
}

/** Thumbnail strip: THUMB_COUNT frames, 90 px tall, tiled side by side into thumbs.jpg. */
export function thumbsArgs(edits: Edits, out: string): string[] {
  const d = Math.max(edits.source.duration, 0.1);
  return [
    "-y",
    // On long videos, decode keyframes only: much faster, and the strip is just a guide.
    ...(d > 120 ? ["-skip_frame", "nokey"] : []),
    "-i",
    edits.source.file,
    "-an",
    "-vf",
    `fps=${(THUMB_COUNT / d).toFixed(6)},scale=-2:${THUMB_HEIGHT},tile=${THUMB_COUNT}x1`,
    "-frames:v",
    "1",
    "-q:v",
    "5",
    "-update",
    "1",
    out,
  ];
}

export function startThumbsJob(id: string, edits: Edits): Job {
  const dir = projectDir(id);
  return startJob(id, "thumbs", async ({ progress, log, signal }) => {
    const tmp = ".tmp/thumbs.jpg";
    await fsp.mkdir(path.join(dir, ".tmp"), { recursive: true });
    await runFfmpeg(thumbsArgs(edits, tmp), { cwd: dir, duration: edits.source.duration, onProgress: progress, onLog: log, signal });
    await fsp.rename(path.join(dir, tmp), path.join(dir, "thumbs.jpg"));
    return "thumbs.jpg";
  });
}

/** 720p H.264 proxy for sources browsers can't play (HEVC, ProRes, 10-bit...). Same timeline as the source. */
export function previewArgs(edits: Edits, out: string): string[] {
  return [
    "-y",
    "-i",
    edits.source.file,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=-2:'min(720,ih)',format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-g",
    "30", // frequent keyframes = fast, accurate seeking in the browser
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    out,
  ];
}

export function startPreviewJob(id: string, edits: Edits): Job {
  const dir = projectDir(id);
  return startJob(id, "preview", async ({ progress, log, signal }) => {
    const tmp = ".tmp/preview.mp4";
    await fsp.mkdir(path.join(dir, ".tmp"), { recursive: true });
    await runFfmpeg(previewArgs(edits, tmp), { cwd: dir, duration: edits.source.duration, onProgress: progress, onLog: log, signal });
    await fsp.rename(path.join(dir, tmp), path.join(dir, "preview.mp4"));
    return "preview.mp4";
  });
}

/** What the editor should play, plus the state of background jobs. */
export function mediaStatus(id: string, edits: Edits) {
  const dir = projectDir(id);
  const hasPreview = fs.existsSync(path.join(dir, "preview.mp4"));
  const previewJob = getJob(id, "preview");
  const thumbsJob = getJob(id, "thumbs");
  return {
    videoFile: hasPreview ? "preview.mp4" : edits.source.file,
    usingPreview: hasPreview,
    preview: previewJob ? { state: previewJob.state, progress: previewJob.progress } : null,
    hasThumbs: fs.existsSync(path.join(dir, "thumbs.jpg")),
    thumbs: thumbsJob ? { state: thumbsJob.state, progress: thumbsJob.progress } : null,
  };
}
