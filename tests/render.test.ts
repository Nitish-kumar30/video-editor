import { describe, it, expect } from "vitest";
import { buildRender, buildAss, rectPx, blurRadii } from "../lib/render";
import { normalize } from "../lib/schema";

const source = { file: "source.mp4", width: 1920, height: 1080, duration: 60, fps: 30, hasAudio: true, codec: "h264" };
const plan = (e: object, opts: object = {}) => buildRender(normalize({ source, ...e }), { outputFile: "exports/out.mp4", ...opts });

describe("buildRender", () => {
  it("passes the whole video through when there are no edits", () => {
    const p = plan({});
    expect(p.filterGraph).toBe("[0:v]setsar=1,format=yuv420p[vout];[0:a]anull[aout]");
    expect(p.outputDuration).toBe(60);
    expect(p.args).toContain("-crf");
    expect(p.args[p.args.indexOf("-crf") + 1]).toBe("18");
    expect(p.args).toContain("+faststart");
    expect(p.args.at(-1)).toBe("exports/out.mp4");
  });

  it("uses split/trim/concat for cuts and keeps audio in sync", () => {
    const p = plan({ cuts: [{ start: 10, end: 20 }, { start: 30, end: 40 }] });
    expect(p.segments).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
      { start: 40, end: 60 },
    ]);
    expect(p.outputDuration).toBe(40);
    expect(p.filterGraph).toContain("split=3");
    expect(p.filterGraph).toContain("asplit=3");
    expect(p.filterGraph).toContain("trim=start=20:end=30,setpts=PTS-STARTPTS");
    expect(p.filterGraph).toContain("atrim=start=20:end=30,asetpts=PTS-STARTPTS");
    expect(p.filterGraph).toMatch(/concat=n=3:v=1:a=1/);
  });

  it("uses a single trim (no concat) for one segment", () => {
    const p = plan({ cuts: [{ start: 0, end: 5 }] });
    expect(p.filterGraph).not.toContain("concat");
    expect(p.filterGraph).toContain("[0:v]trim=start=5:end=60,setpts=PTS-STARTPTS");
  });

  it("throws when everything is cut", () => {
    expect(() => plan({ cuts: [{ start: 0, end: 60 }] })).toThrow(/Everything is cut/);
  });

  it("builds blur with clamped, even crop values and enable=between", () => {
    const p = plan({ regions: [{ type: "blur", x: 0.5, y: 0.1, w: 0.1, h: 0.05, start: 30, end: 50, strength: 100 }] });
    // 0.1*1920 = 192, 0.05*1080 = 54, x = 960, y = 108
    expect(p.filterGraph).toContain("crop=192:54:960:108,boxblur=luma_radius=26:luma_power=2:chroma_radius=13");
    expect(p.filterGraph).toContain("overlay=x=960:y=108:enable='between(t,30,50)'");
  });

  it("clamps boxblur radii to what boxblur accepts", () => {
    expect(blurRadii(100, 20, 10, 2160)).toEqual({ luma: 4, chroma: 2 });
    expect(blurRadii(1, 400, 400, 1080)).toEqual({ luma: 1, chroma: 1 });
  });

  it("rounds rectangles to even pixels inside the frame", () => {
    expect(rectPx({ x: 0.99, y: 0.99, w: 0.5, h: 0.5 }, 1921, 1081)).toEqual({ x: 1902, y: 1070, w: 18, h: 10 });
    const r = rectPx({ x: 0.123, y: 0.457, w: 0.333, h: 0.111 }, 1280, 720);
    for (const v of Object.values(r)) expect(v % 2).toBe(0);
  });

  it("builds pixelate with nearest-neighbour upscaling", () => {
    const p = plan({ regions: [{ type: "pixelate", x: 0, y: 0, w: 0.25, h: 0.25, strength: 50 }] });
    expect(p.filterGraph).toMatch(/crop=480:270:0:0,scale=\d+:\d+:flags=area,scale=480:270:flags=neighbor/);
  });

  it("builds box regions with drawbox", () => {
    const p = plan({ regions: [{ type: "box", x: 0.5, y: 0.5, w: 0.1, h: 0.1, color: "#ff0000", start: 1, end: 2 }] });
    expect(p.filterGraph).toContain("drawbox=x=960:y=540:w=192:h=108:color=0xff0000@1:t=fill:enable='between(t,1,2)'");
  });

  it("writes text to a file and uses drawtext with relative paths", () => {
    const p = plan({ texts: [{ id: "t1", text: "Call me: 555-1234, it's 100%", x: 0.1, y: 0.2, size: 0.05, background: "#000000", bgOpacity: 0.5 }] });
    expect(p.files).toEqual([{ path: ".tmp/text_t1.txt", content: "Call me: 555-1234, it's 100%" }]);
    expect(p.fontFile).toBe(".tmp/font.ttf");
    expect(p.filterGraph).toContain("drawtext=fontfile=.tmp/font.ttf:textfile=.tmp/text_t1.txt:expansion=none:fontsize=54");
    expect(p.filterGraph).toContain("box=1:boxcolor=0x000000@0.5");
    expect(p.filterGraph).not.toMatch(/[A-Za-z]:\\/); // no Windows drive letters
  });

  it("can render text through libass instead", () => {
    const p = plan({ texts: [{ id: "t1", text: "A {b}\nC", x: 0.1, y: 0.2 }] }, { textEngine: "ass" });
    expect(p.filterGraph).toContain("ass=filename=.tmp/texts.ass:fontsdir=.tmp");
    const ass = p.files.find((f) => f.path === ".tmp/texts.ass")!.content;
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("{\\pos(192,216)}A \\{b\\}\\NC");
  });

  it("buildAss converts colors to &HAABBGGRR", () => {
    const ass = buildAss(normalize({ source, texts: [{ id: "t", text: "x", color: "#112233", background: "#445566", bgOpacity: 1 }] }).texts, 100, 100);
    expect(ass).toContain(",&H00332211,&H00332211,&H00665544,");
  });

  it("overlays images with opacity", () => {
    const p = plan({ images: [{ file: "assets/logo.png", x: 0.8, y: 0.8, w: 0.15, opacity: 0.7, start: 0, end: 10 }] });
    expect(p.args.join(" ")).toContain("-i source.mp4 -i assets/logo.png");
    expect(p.filterGraph).toContain("[1:v]scale=288:-1,format=rgba,colorchannelmixer=aa=0.7");
    expect(p.filterGraph).toContain("overlay=x=1536:y=864:eof_action=repeat:enable='between(t,0,10)'");
  });

  it("crops, scales and fades on the output timeline", () => {
    const p = plan({
      cuts: [{ start: 50, end: 60 }],
      crop: { x: 0.3, y: 0, w: 0.3164, h: 1 },
      video: { fadeIn: 1, fadeOut: 2 },
      export: { height: 720 },
    });
    expect(p.filterGraph).toContain("crop=606:1080:576:0,scale=-2:720,setsar=1,fade=t=in:st=0:d=1,fade=t=out:st=48:d=2,format=yuv420p");
    expect(p.outHeight).toBe(720);
    expect(p.outWidth % 2).toBe(0);
  });

  it("mixes looping music, applies audio fades, and handles mute", () => {
    const p = plan({ audio: { volume: 0.5, fadeOut: 3, music: { file: "assets/song.mp3", volume: 0.3, loop: true } } });
    expect(p.args.join(" ")).toContain("-stream_loop -1 -i assets/song.mp3");
    expect(p.filterGraph).toContain("[1:a]atrim=end=60,asetpts=PTS-STARTPTS,volume=0.3");
    expect(p.filterGraph).toContain("volume=0.5");
    expect(p.filterGraph).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(p.filterGraph).toContain("afade=t=out:st=57:d=3[aout]");

    const muted = plan({ audio: { mute: true } });
    expect(muted.args).toContain("-an");
    expect(muted.filterGraph).not.toContain("0:a");

    const mutedWithMusic = plan({ audio: { mute: true, music: { file: "assets/song.mp3", loop: false } } });
    expect(mutedWithMusic.args.join(" ")).not.toContain("-stream_loop");
    expect(mutedWithMusic.filterGraph).toContain("apad=whole_dur=60");
    expect(mutedWithMusic.args).toContain("[aout]");
  });

  it("uses -an for sources without audio", () => {
    const p = buildRender(normalize({ source: { ...source, hasAudio: false }, cuts: [{ start: 1, end: 2 }, { start: 3, end: 4 }] }), { outputFile: "o.mp4" });
    expect(p.args).toContain("-an");
    expect(p.filterGraph).toContain("concat=n=3:v=1:a=0");
  });

  it("maps quality to CRF and accepts overrides", () => {
    const p = plan({ export: { quality: "small" } });
    expect(p.args[p.args.indexOf("-crf") + 1]).toBe("28");
    const q = plan({ export: { quality: "small" } }, { quality: "medium" });
    expect(q.args[q.args.indexOf("-crf") + 1]).toBe("23");
  });

  it("moves very long filter graphs into a script file", () => {
    const regions = Array.from({ length: 60 }, (_, i) => ({ type: "blur", x: 0.1, y: 0.1, w: 0.1, h: 0.1, start: i, end: i + 1 }));
    const p = plan({ regions });
    expect(p.args).toContain("-filter_complex_script");
    expect(p.files.some((f) => f.path === ".tmp/graph.txt")).toBe(true);
  });
});
