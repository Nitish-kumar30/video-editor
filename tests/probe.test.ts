import { describe, it, expect } from "vitest";
import { parseProbeOutput, isBrowserPlayable } from "../lib/ffmpeg";

const PHONE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_1234.MOV':
  Metadata:
    major_brand     : qt
  Duration: 00:01:02.53, start: 0.000000, bitrate: 10233 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 10057 kb/s, 29.98 fps, 30 tbr, 600 tbn (default)
      Metadata:
        creation_time   : 2024-05-01T10:00:00.000000Z
        handler_name    : Core Media Video
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 160 kb/s (default)
  Stream #0:2[0x3](und): Data: none (mebx / 0x7862656D), 0 kb/s (default)`;

const OLD_ROTATE = `  Duration: 00:00:10.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0(eng): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1280x720, 1000 kb/s, 30 fps, 30 tbr, 90k tbn (default)
    Metadata:
      rotate          : 90
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, mono, fltp, 64 kb/s`;

const NO_AUDIO_WITH_COVER = `  Duration: 00:00:05.50, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc), 300x300, 90k tbr, 90k tbn (attached pic)
  Stream #0:1: Video: vp9 (Profile 0), yuv420p(tv), 640x360, SAR 1:1 DAR 16:9, 25 fps, 25 tbr, 1k tbn`;

describe("parseProbeOutput", () => {
  it("parses a rotated HEVC phone video and swaps width/height", () => {
    const p = parseProbeOutput(PHONE);
    expect(p).toMatchObject({ width: 1080, height: 1920, duration: 62.53, fps: 29.98, hasAudio: true, codec: "hevc", rotation: -90 });
    expect(p.pixFmt).toBe("yuv420p10le");
    expect(isBrowserPlayable(p)).toBe(false);
  });

  it("understands the old 'rotate' metadata", () => {
    const p = parseProbeOutput(OLD_ROTATE);
    expect(p).toMatchObject({ width: 720, height: 1280, rotation: 90, hasAudio: true });
    expect(isBrowserPlayable(p)).toBe(true);
  });

  it("ignores cover art and detects missing audio", () => {
    const p = parseProbeOutput(NO_AUDIO_WITH_COVER);
    expect(p).toMatchObject({ width: 640, height: 360, codec: "vp9", fps: 25, hasAudio: false, duration: 5.5 });
  });

  it("throws when there is no video", () => {
    expect(() => parseProbeOutput("  Duration: 00:00:05.00\n  Stream #0:0: Audio: mp3, 44100 Hz")).toThrow(/No video/);
  });
});
