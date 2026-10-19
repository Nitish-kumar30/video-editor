/** Test helpers: run the bundled FFmpeg and read back frames / audio for checks. */
import { spawn } from "node:child_process";
import { ffmpegPath } from "../lib/ffmpeg";

export function ff(args: string[], cwd?: string): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { cwd, windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`ffmpeg ${args.join(" ")}\n${err.slice(-2000)}`));
    });
  });
}

/** Info about an output file: duration, video size, whether it has audio, rotation side data. */
export async function info(file: string) {
  const { stderr } = await ff(["-i", file, "-f", "null", "-t", "0", "-"]).catch((e) => ({ stderr: String(e) }));
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const size = stderr.match(/Video: [^\n]*?, (\d{2,5})x(\d{2,5})/);
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0,
    width: size ? +size[1] : 0,
    height: size ? +size[2] : 0,
    hasAudio: /Stream #0:\d+[^\n]*: Audio:/.test(stderr),
    codec: (stderr.match(/Stream #0:\d+[^\n]*: Video: (\w+)/) || [])[1] || "",
    rotated: /displaymatrix: rotation/.test(stderr.split("Output #0")[0]),
  };
}

/** One RGB frame at time t (seconds), optionally cropped to a pixel rect. */
export async function frameRgb(file: string, t: number, crop?: { x: number; y: number; w: number; h: number }) {
  const vf = crop ? [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : [];
  const { stdout } = await ff(["-ss", String(t), "-i", file, "-frames:v", "1", ...(vf.length ? ["-vf", vf.join(",")] : []), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return stdout;
}

export function meanRgb(buf: Buffer) {
  let r = 0, g = 0, b = 0;
  const n = buf.length / 3;
  for (let i = 0; i < buf.length; i += 3) {
    r += buf[i];
    g += buf[i + 1];
    b += buf[i + 2];
  }
  return { r: r / n, g: g / n, b: b / n };
}

/** Sum of absolute differences between horizontal neighbours: high for sharp images, low for blurred ones. */
export function edgeEnergy(buf: Buffer, width: number): number {
  let e = 0;
  const stride = width * 3;
  for (let i = 0; i + 3 < buf.length; i += 3) {
    if ((i + 3) % stride === 0) continue;
    e += Math.abs(buf[i] - buf[i + 3]) + Math.abs(buf[i + 1] - buf[i + 4]) + Math.abs(buf[i + 2] - buf[i + 5]);
  }
  return e / (buf.length / 3);
}

/** Times (s) where the video goes from dark to bright, assuming constant `fps` output. */
export async function flashOnsets(file: string, fps: number): Promise<number[]> {
  const { stdout } = await ff(["-i", file, "-vf", "scale=8:8,format=gray", "-f", "rawvideo", "-"]);
  const onsets: number[] = [];
  let prev = false;
  for (let f = 0; f * 64 < stdout.length; f++) {
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += stdout[f * 64 + i];
    const bright = sum / 64 > 128;
    if (bright && !prev) onsets.push(f / fps);
    prev = bright;
  }
  return onsets;
}

/** Times (s) where the audio goes from silence to a tone (5 ms resolution). */
export async function beepOnsets(file: string): Promise<number[]> {
  const rate = 8000;
  const { stdout } = await ff(["-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const win = rate / 200;
  const onsets: number[] = [];
  let prev = false;
  for (let w = 0; (w + 1) * win <= samples.length; w++) {
    let sq = 0;
    for (let i = w * win; i < (w + 1) * win; i++) sq += samples[i] * samples[i];
    const loud = Math.sqrt(sq / win) > 1500;
    if (loud && !prev) onsets.push(w / 200);
    prev = loud;
  }
  return onsets;
}
