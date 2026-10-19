/**
 * FFmpeg helpers (server/CLI only).
 *
 * - ffmpegPath(): FFMPEG_PATH env var, or the binary shipped by the `ffmpeg-static` package.
 * - probe(): reads video info by parsing `ffmpeg -hide_banner -i <file>` output (no ffprobe needed).
 * (The turbopackIgnore comments only silence Next.js build warnings about file tracing.)
 * - runFfmpeg(): spawns FFmpeg with an args ARRAY (no shell, so paths with spaces are safe)
 *   and reports progress from `-progress pipe:1`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import type { SourceInfo } from "./schema";

let cachedPath: string | null = null;

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (cachedPath) return cachedPath;
  const p = ffmpegStatic as unknown as string | null;
  if (!p || !fs.existsSync(p)) {
    throw new Error(
      "FFmpeg binary not found. Run `npm install` again (ffmpeg-static downloads it), " +
        "or set FFMPEG_PATH to an installed ffmpeg executable.",
    );
  }
  cachedPath = p;
  return p;
}

export interface ProbeResult extends Omit<SourceInfo, "file"> {
  rotation: number;
  pixFmt: string;
  audioCodec: string;
}

/** Parse the stderr text that `ffmpeg -i <file>` prints. Exported for tests. */
export function parseProbeOutput(text: string): ProbeResult {
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durMatch ? +durMatch[1] * 3600 + +durMatch[2] * 60 + parseFloat(durMatch[3]) : 0;

  const lines = text.split(/\r?\n/);
  const videoIdx = lines.findIndex((l) => /Stream #\d+:\d+.*: Video: /.test(l) && !/attached pic/.test(l));
  const audioLine = lines.find((l) => /Stream #\d+:\d+.*: Audio: /.test(l));
  if (videoIdx < 0) throw new Error("No video stream found in this file.");
  const videoLine = lines[videoIdx];

  const codec = (videoLine.match(/Video: ([a-zA-Z0-9_]+)/) || [])[1] || "";
  // pixel format is the first token after "Video: codec (...)," e.g. "yuv420p(tv, bt709)" or "yuv420p10le"
  const pixFmt = (videoLine.match(/Video: [^,]+, ([a-z0-9]+)/) || [])[1] || "";
  const size = videoLine.match(/, (\d{2,5})x(\d{2,5})/);
  let width = size ? +size[1] : 0;
  let height = size ? +size[2] : 0;
  const fpsMatch = videoLine.match(/([\d.]+) fps/) || videoLine.match(/([\d.]+)k? tbr/);
  let fps = fpsMatch ? parseFloat(fpsMatch[1]) : 30;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fps = 30;

  // Rotation: FFmpeg 5+ prints "displaymatrix: rotation of -90.00 degrees" in the stream's side data;
  // older builds print "rotate : 90" in the stream metadata. Look only at this stream's block.
  let rotation = 0;
  for (let i = videoIdx + 1; i < lines.length && !/^\s*Stream #/.test(lines[i]); i++) {
    const m = lines[i].match(/rotation of (-?[\d.]+) degrees/) || lines[i].match(/^\s*rotate\s*:\s*(-?\d+)/);
    if (m) {
      rotation = Math.round(parseFloat(m[1]));
      break;
    }
  }
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];

  return {
    width,
    height,
    duration: Math.round(duration * 1000) / 1000,
    fps: Math.round(fps * 1000) / 1000,
    hasAudio: !!audioLine,
    codec,
    rotation,
    pixFmt,
    audioCodec: audioLine ? (audioLine.match(/Audio: ([a-zA-Z0-9_]+)/) || [])[1] || "" : "",
  };
}

/** Probe a media file. `file` may be relative to `cwd`. */
export async function probe(file: string, cwd?: string): Promise<ProbeResult> {
  const text = await new Promise<string>((resolve, reject) => {
    const proc = spawn(/*turbopackIgnore: true*/ ffmpegPath(), ["-hide_banner", "-nostdin", "-i", file], { cwd, windowsHide: true });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", () => resolve(err)); // exit code is 1 ("At least one output file must be specified") — expected
  });
  if (/No such file or directory|Invalid data found/.test(text) && !/Duration:/.test(text)) {
    throw new Error("FFmpeg could not read this file: " + text.trim().split(/\r?\n/).pop());
  }
  return parseProbeOutput(text);
}

const filterCache = new Map<string, Promise<Set<string>>>();

/** True if this FFmpeg build has the given filter (e.g. "drawtext" needs libfreetype). */
export async function hasFilter(name: string): Promise<boolean> {
  const bin = ffmpegPath();
  if (!filterCache.has(bin)) {
    filterCache.set(
      bin,
      new Promise((resolve) => {
        const proc = spawn(/*turbopackIgnore: true*/ bin, ["-hide_banner", "-filters"], { windowsHide: true });
        let out = "";
        proc.stdout.on("data", (d) => (out += d.toString()));
        proc.on("error", () => resolve(new Set()));
        proc.on("close", () => {
          const names = new Set<string>();
          for (const line of out.split(/\r?\n/)) {
            const m = line.match(/^\s*[TSC.]{2,3}\s+(\S+)\s+\S+->\S+/);
            if (m) names.add(m[1]);
          }
          resolve(names);
        });
      }),
    );
  }
  return (await filterCache.get(bin)!).has(name);
}

/** Codecs/pixel formats that browsers play reliably. Others get a 720p H.264 preview. */
export function isBrowserPlayable(p: Pick<ProbeResult, "codec" | "pixFmt">): boolean {
  const okCodec = ["h264", "vp8", "vp9", "av1"].includes(p.codec);
  const okPix = !p.pixFmt || /^yuv(j)?420p$/.test(p.pixFmt);
  return okCodec && okPix;
}

export interface RunOptions {
  cwd?: string;
  /** Expected output duration in seconds, used to turn progress into a percentage. */
  duration?: number;
  onProgress?: (percent: number) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

/**
 * Run FFmpeg. Adds `-progress pipe:1 -nostats` so progress can be parsed.
 * Resolves on exit code 0; rejects with the last stderr lines otherwise.
 */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const fullArgs = ["-hide_banner", "-nostdin", "-progress", "pipe:1", "-nostats", ...args];
    const proc = spawn(/*turbopackIgnore: true*/ ffmpegPath(), fullArgs, { cwd: opts.cwd, windowsHide: true });
    const tail: string[] = [];
    let stdoutBuf = "";
    let stderrBuf = "";

    const onAbort = () => proc.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (d) => {
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() || "";
      for (const line of lines) {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/); // both are microseconds
        if (m && opts.duration && opts.onProgress) {
          const pct = (parseInt(m[1], 10) / 1e6 / opts.duration) * 100;
          opts.onProgress(Math.max(0, Math.min(99.9, pct)));
        }
      }
    });
    proc.stderr.on("data", (d) => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 40) tail.shift();
        opts.onLog?.(line);
      }
    });
    proc.on("error", (e) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    proc.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (stderrBuf.trim()) tail.push(stderrBuf);
      if (opts.signal?.aborted) return reject(new Error("Canceled"));
      if (code === 0) {
        opts.onProgress?.(100);
        resolve();
      } else {
        const err = new Error(`FFmpeg exited with code ${code}\n${tail.slice(-15).join("\n")}`);
        (err as Error & { log?: string[] }).log = tail.slice(-15);
        reject(err);
      }
    });
  });
}
