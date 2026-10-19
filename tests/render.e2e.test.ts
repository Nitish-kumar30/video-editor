/**
 * Real renders with FFmpeg on small generated clips. Checks output duration, frame
 * contents (blur/box/text/logo in the right place and time) and audio/video sync.
 * Runs in a temporary projects folder (tests/.output/projects).
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ff, info, frameRgb, meanRgb, edgeEnergy, flashOnsets, beepOnsets } from "./helpers";

const OUT = path.resolve("tests/.output");
process.env.CLIPFORGE_PROJECTS_DIR = path.join(OUT, "projects");

type Storage = typeof import("../lib/storage");
type Media = typeof import("../lib/media");
type Exporter = typeof import("../lib/export");
type Jobs = typeof import("../lib/jobs");
let storage: Storage, media: Media, exporter: Exporter, jobs: Jobs;

/** Create a project from a generated clip, like `npm run new` does. */
async function makeProject(name: string, ffArgs: string[]) {
  const file = path.join(OUT, `${name}.mp4`);
  if (!fs.existsSync(file)) await ff(["-y", ...ffArgs, file]);
  const id = await storage.createProjectDir(name);
  const tmp = path.join(storage.projectDir(id), ".tmp", "upload");
  fs.copyFileSync(file, tmp);
  const res = await media.installSource(id, tmp, path.basename(file));
  return { id, dir: storage.projectDir(id), ...res };
}

async function waitJob(id: string, kind: "thumbs" | "preview") {
  for (let i = 0; i < 600; i++) {
    const j = jobs.getJob(id, kind);
    if (!j || j.state !== "running") return j;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function render(id: string, edits: object, opts: Parameters<Exporter["renderProject"]>[1] = {}) {
  const { edits: current } = await storage.readEdits(id);
  await storage.writeEdits(id, { ...current, ...edits });
  const out = await exporter.renderProject(id, opts);
  return path.join(storage.projectDir(id), out);
}

beforeAll(async () => {
  fs.rmSync(path.join(OUT, "projects"), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  storage = await import("../lib/storage");
  media = await import("../lib/media");
  exporter = await import("../lib/export");
  jobs = await import("../lib/jobs");
});

describe("real renders", () => {
  it("removes cut parts and keeps audio in sync (variable frame rate source)", async () => {
    // White flash + 1 kHz beep during the first 0.1 s of every second. Timestamps are jittered (VFR).
    const p = await makeProject("sync", [
      "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=10,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,1),0.1)',setpts='(N/30+0.005*mod(N,3))/TB'",
      "-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=10",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-c:a", "aac",
    ]);
    expect(p.edits.source).toMatchObject({ width: 320, height: 240, hasAudio: true });
    const out = await render(p.id, { cuts: [{ start: 2.3, end: 3.6 }, { start: "6.5", end: 7.2 }] });

    const i = await info(out);
    expect(i.duration).toBeCloseTo(8, 1);
    // source flashes at 0,1,2 | 4,5,6 | 8,9 -> output times below (7 is inside a cut)
    const expected = [0, 1, 2, 2.7, 3.7, 4.7, 6.0, 7.0];
    const flashes = await flashOnsets(out, 30);
    const beeps = await beepOnsets(out);
    expect(flashes.length).toBe(expected.length);
    expect(beeps.length).toBe(expected.length);
    expected.forEach((t, k) => {
      expect(Math.abs(flashes[k] - t)).toBeLessThan(0.05);
      expect(Math.abs(beeps[k] - t)).toBeLessThan(0.05);
      expect(Math.abs(beeps[k] - flashes[k])).toBeLessThan(0.05); // A/V sync
    });
  });

  it("puts blur, box, text and logo in the right place at the right time", async () => {
    const p = await makeProject("effects", [
      // grainy test pattern: lots of fine detail, so blur is easy to measure
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=6,noise=alls=40:allf=t",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    ]);
    // a 64x32 solid magenta logo
    await ff(["-y", "-f", "lavfi", "-i", "color=c=0xff00ff:s=64x32", "-frames:v", "1", path.join(p.dir, "assets", "logo.png")]);

    const out = await render(p.id, {
      regions: [
        { type: "blur", x: 0, y: 0, w: 0.5, h: 0.5, start: 1, end: 3, strength: 80 },
        { type: "box", x: 0.75, y: 0.75, w: 0.25, h: 0.25, color: "#ff0000", start: 2, end: 4 },
      ],
      texts: [{ text: "HELLO", x: 0.55, y: 0.05, size: 0.1, color: "#ffffff", background: "#000000", bgOpacity: 1, start: 0, end: 6 }],
      images: [{ file: "assets/logo.png", x: 0.05, y: 0.75, w: 0.1, opacity: 1, start: 4, end: 6 }],
    });
    const src = path.join(p.dir, p.edits.source.file);
    const tl = { x: 0, y: 0, w: 320, h: 180 };

    // blur: only inside its time range, only inside its rectangle
    const blurred = edgeEnergy(await frameRgb(out, 2, tl), 320);
    const sharp = edgeEnergy(await frameRgb(src, 2, tl), 320);
    expect(blurred).toBeLessThan(sharp * 0.5);
    const before = edgeEnergy(await frameRgb(out, 0.5, tl), 320);
    expect(before).toBeGreaterThan(edgeEnergy(await frameRgb(src, 0.5, tl), 320) * 0.8);
    const bl = { x: 0, y: 200, w: 300, h: 100 }; // untouched area
    expect(edgeEnergy(await frameRgb(out, 2, bl), 300)).toBeGreaterThan(edgeEnergy(await frameRgb(src, 2, bl), 300) * 0.8);

    // box: red between 2 and 4 s
    const boxArea = { x: 490, y: 280, w: 140, h: 70 };
    const red = meanRgb(await frameRgb(out, 3, boxArea));
    expect(red.r).toBeGreaterThan(200);
    expect(red.g).toBeLessThan(40);
    expect(meanRgb(await frameRgb(out, 1, boxArea)).g).toBeGreaterThan(40);

    // text: black box with white letters near the top right
    const textArea = { x: 356, y: 22, w: 100, h: 24 };
    const t = meanRgb(await frameRgb(out, 1, textArea));
    expect(t.r).toBeGreaterThan(20); // some white letters
    expect(t.r).toBeLessThan(200); // on a dark box

    // logo: magenta, only from 4 s
    const logoArea = { x: 36, y: 276, w: 20, h: 12 };
    const isMagenta = (c: { r: number; g: number; b: number }) => c.r > 200 && c.g < 40 && c.b > 200;
    expect(isMagenta(meanRgb(await frameRgb(out, 5, logoArea)))).toBe(true);
    expect(isMagenta(meanRgb(await frameRgb(out, 1, logoArea)))).toBe(false);
  });

  it("crops to 9:16, scales, fades, and swaps audio for music", async () => {
    const p = await makeProject("crop", [
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    ]);
    await ff(["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1.5", path.join(p.dir, "assets", "song.mp3")]);
    const out = await render(
      p.id,
      {
        crop: { x: 0.3, y: 0, w: 0.3164, h: 1 },
        video: { fadeIn: 0.5, fadeOut: 0.5 },
        audio: { mute: true, music: { file: "assets/song.mp3", volume: 1, loop: true } },
      },
      { height: 480, filename: "reel" },
    );
    expect(path.basename(out)).toBe("reel.mp4");
    const i = await info(out);
    expect(i.height).toBe(480);
    expect(i.width).toBe(270);
    expect(i.hasAudio).toBe(true);
    expect(i.duration).toBeCloseTo(4, 1);
    // first frame is black because of the fade-in
    expect(meanRgb(await frameRgb(out, 0)).g).toBeLessThan(20);
    // looping music still plays at the end
    const beeps = await beepOnsets(out);
    expect(beeps[0]).toBeLessThan(0.05);
  });

  it("drops audio when muted without music, and handles silent sources", async () => {
    const p = await makeProject("silent", ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
    expect(p.edits.source.hasAudio).toBe(false);
    const out = await render(p.id, { cuts: [{ start: 1, end: 1.5 }] });
    const i = await info(out);
    expect(i.hasAudio).toBe(false);
    expect(i.duration).toBeCloseTo(2.5, 1);
  });

  it("handles rotated phone videos (portrait output, no leftover rotation)", async () => {
    const plain = path.join(OUT, "rot-src.mp4");
    await ff(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", plain]);
    const rotated = path.join(OUT, "rotated.mp4");
    await ff(["-y", "-display_rotation:v:0", "90", "-i", plain, "-c", "copy", rotated]);
    const p = await makeProject("rotated", ["-i", rotated, "-c", "copy"]); // keeps the rotation side data
    expect(p.probe.rotation).not.toBe(0);
    expect(p.edits.source).toMatchObject({ width: 240, height: 320 });
    const out = await render(p.id, { regions: [{ type: "box", x: 0, y: 0, w: 1, h: 0.5, color: "#0000ff" }] });
    const i = await info(out);
    expect(i).toMatchObject({ width: 240, height: 320, rotated: false });
    expect(meanRgb(await frameRgb(out, 1, { x: 0, y: 0, w: 240, h: 150 })).b).toBeGreaterThan(200);
  });

  it("makes thumbnails and an H.264 preview for HEVC sources", async () => {
    const p = await makeProject("hevc", [
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
      "-c:v", "libx265", "-pix_fmt", "yuv420p", "-x265-params", "log-level=error", "-tag:v", "hvc1",
    ]);
    expect(p.edits.source.codec).toBe("hevc");
    expect(p.needsPreview).toBe(true);
    expect((await waitJob(p.id, "preview"))?.state).toBe("done");
    expect((await waitJob(p.id, "thumbs"))?.state).toBe("done");
    const prev = await info(path.join(p.dir, "preview.mp4"));
    expect(prev.codec).toBe("h264");
    expect(prev.duration).toBeCloseTo(2, 1);
    const thumbs = await info(path.join(p.dir, "thumbs.jpg"));
    expect(thumbs.height).toBe(90);
    expect(media.mediaStatus(p.id, p.edits).videoFile).toBe("preview.mp4");
  });
});
