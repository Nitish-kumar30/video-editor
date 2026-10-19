import { describe, it, expect } from "vitest";
import { normalize, parseTime, normalizeColor, normalizeAssetPath, formatTime } from "../lib/schema";

const source = { file: "source.mp4", width: 1920, height: 1080, duration: 60, fps: 30, hasAudio: true, codec: "h264" };

describe("normalize()", () => {
  it("never crashes on junk input", () => {
    for (const junk of [null, undefined, 42, "x", [], { cuts: "nope", regions: [null, 3, "a"] }, { source: { duration: "abc" } }]) {
      const e = normalize(junk);
      expect(e.version).toBe(1);
      expect(Array.isArray(e.cuts)).toBe(true);
    }
  });

  it("fills defaults and ids", () => {
    const e = normalize({ source, regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], texts: [{ text: "Hi" }] });
    expect(e.regions[0].type).toBe("blur");
    expect(e.regions[0].id).toMatch(/^blur_/);
    expect(e.regions[0].strength).toBe(50);
    expect(e.regions[0].end).toBe(60);
    expect(e.texts[0].color).toBe("#ffffff");
    expect(e.audio.volume).toBe(1);
    expect(e.export.quality).toBe("high");
  });

  it("clamps rectangles inside the frame and times inside the video", () => {
    const e = normalize({ source, regions: [{ x: 0.9, y: -1, w: 0.5, h: 2, start: -5, end: 999 }] });
    const r = e.regions[0];
    expect(r.w).toBe(0.5);
    expect(r.x).toBe(0.5); // moved left so it fits
    expect(r.h).toBe(1);
    expect(r.y).toBe(0);
    expect(r.start).toBe(0);
    expect(r.end).toBe(60);
  });

  it("accepts time strings and swaps reversed ranges", () => {
    const e = normalize({ source, cuts: [{ start: "1:45", end: "1:20" }, { start: "0:30", end: "0:50.5" }] });
    // 1:45 is past the 60 s duration, so it is clamped
    expect(e.cuts[0]).toMatchObject({ start: 60 - 1, end: 60 });
    expect(e.cuts[1]).toMatchObject({ start: 30, end: 50.5 });
  });

  it("dedupes ids and rejects unsafe asset paths", () => {
    const e = normalize({
      source,
      cuts: [{ id: "a", start: 1, end: 2 }, { id: "a", start: 3, end: 4 }],
      images: [{ file: "../../etc/passwd" }, { file: "logo.png" }, { file: "C:\\\\x.png" }],
      audio: { music: { file: "assets/../x.mp3" } },
    });
    expect(e.cuts[0].id).toBe("a");
    expect(e.cuts[1].id).not.toBe("a");
    expect(e.images.map((i) => i.file)).toEqual(["assets/logo.png"]);
    expect(e.audio.music).toBeNull();
  });

  it("drops a full-frame crop and keeps a real one", () => {
    expect(normalize({ source, crop: { x: 0, y: 0, w: 1, h: 1 } }).crop).toBeNull();
    expect(normalize({ source, crop: { x: 0.3, y: 0, w: 0.316, h: 1 } }).crop).toEqual({ x: 0.3, y: 0, w: 0.316, h: 1 });
  });

  it("is idempotent", () => {
    const once = normalize({ source, cuts: [{ start: 1, end: 2 }], texts: [{ text: "x", background: "red" }] });
    expect(normalize(once)).toEqual(once);
  });
});

describe("helpers", () => {
  it("parseTime", () => {
    expect(parseTime(12.5)).toBe(12.5);
    expect(parseTime("80")).toBe(80);
    expect(parseTime("1:20")).toBe(80);
    expect(parseTime("1:02:03.5")).toBe(3723.5);
    expect(parseTime("abc")).toBeUndefined();
  });
  it("normalizeColor", () => {
    expect(normalizeColor("#ABC", "#000000")).toBe("#aabbcc");
    expect(normalizeColor("red", "#000000")).toBe("#ff0000");
    expect(normalizeColor("0x112233", "#000000")).toBe("#112233");
    expect(normalizeColor("nope", "#000000")).toBe("#000000");
  });
  it("normalizeAssetPath", () => {
    expect(normalizeAssetPath("./assets/a b.png")).toBe("assets/a b.png");
    expect(normalizeAssetPath("assets\\logo.png")).toBe("assets/logo.png");
    expect(normalizeAssetPath("assets/../x")).toBeNull();
  });
  it("formatTime", () => {
    expect(formatTime(83.456)).toBe("1:23.46");
    expect(formatTime(3725, 0)).toBe("1:02:05");
  });
});
