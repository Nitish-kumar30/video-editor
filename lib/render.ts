/**
 * edits.json -> FFmpeg arguments.
 *
 * buildRender() is a PURE function: it does no file or process I/O, so it is easy to
 * unit test (see tests/render.test.ts). lib/export.ts writes the small helper files
 * it asks for (text files, font, long filter graphs) and then runs FFmpeg with the
 * project folder as the working directory. All paths in the filter graph are
 * RELATIVE (".tmp/…", "assets/…") so Windows drive-letter colons never appear in it.
 *
 * Pipeline order (all on the SOURCE timeline until step 5):
 *   1. region effects (blur / pixelate / box), enabled between start and end
 *   2. text (drawtext)
 *   3. images / logos (overlay)
 *   4. cuts: split -> trim/atrim -> concat   (output timeline starts here)
 *   5. crop -> scale -> video fades -> yuv420p
 *   6. audio: volume -> music mix -> fades (or -an)
 *
 * To add a new effect: add its fields in lib/schema.ts, emit its filter here, add a
 * live preview in components/editor/Stage.tsx and fields in Inspector.tsx.
 */
import type { Edits, Quality, Region, TextItem, ImageItem } from "./schema";
import { keepSegments, outputDuration, type Segment } from "./timeline";

export const CRF: Record<Quality, number> = { high: 18, medium: 23, small: 28 };

export interface RenderOptions {
  /** Output path relative to the project folder, e.g. "exports/my-video.mp4". */
  outputFile: string;
  /** Temp folder relative to the project folder. Default ".tmp". */
  tmpDir?: string;
  /** Overrides for edits.export (used by the Export dialog / CLI flags). */
  height?: Edits["export"]["height"];
  quality?: Quality;
  /** "drawtext" (default) or "ass" for FFmpeg builds without drawtext. lib/export.ts picks automatically. */
  textEngine?: "drawtext" | "ass";
}

export interface HelperFile {
  /** Path relative to the project folder. */
  path: string;
  content: string;
}

export interface RenderPlan {
  args: string[];
  filterGraph: string;
  /** Text files the caller must write before running FFmpeg. */
  files: HelperFile[];
  /** If set, copy the bundled font to this path (relative to the project folder). */
  fontFile: string | null;
  segments: Segment[];
  outputDuration: number;
  outWidth: number;
  outHeight: number;
}

// ---------------------------------------------------------------------------
// number helpers
// ---------------------------------------------------------------------------

/** Compact number formatting for filter strings: 3 decimals max, no trailing zeros. */
export function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
const evenRound = (v: number) => Math.round(v / 2) * 2;
const evenFloor = (v: number) => Math.floor(v / 2) * 2;
const hex = (c: string) => "0x" + c.replace("#", "");
const between = (s: number, e: number) => `enable='between(t,${n(s)},${n(e)})'`;

/** Convert a normalized rect to even pixel values that stay inside a W×H frame. */
export function rectPx(r: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const x = Math.min(Math.max(0, evenRound(r.x * W)), evenFloor(W - 2));
  const y = Math.min(Math.max(0, evenRound(r.y * H)), evenFloor(H - 2));
  const w = Math.min(Math.max(2, evenRound(r.w * W)), evenFloor(W - x));
  const h = Math.min(Math.max(2, evenRound(r.h * H)), evenFloor(H - y));
  return { x, y, w, h };
}

/** Blur radii for boxblur: strength 100 ≈ 4% of the frame height, clamped so boxblur never errors. */
export function blurRadii(strength: number, w: number, h: number, frameH: number) {
  const want = Math.max(1, Math.round((strength / 100) * frameH * 0.04));
  const m = Math.min(w, h);
  const luma = Math.max(0, Math.min(want, Math.ceil(m / 2) - 1));
  const chroma = Math.max(0, Math.min(want, Math.ceil(m / 4) - 1));
  return { luma, chroma };
}

/** Pixelate block size in pixels: strength 100 ≈ 5% of the frame height. */
export function pixelBlock(strength: number, frameH: number): number {
  return Math.max(2, Math.round((strength / 100) * frameH * 0.05));
}

/** Metrics of the bundled font (DejaVu Sans), as a fraction of the font size. */
export const FONT_FAMILY = "DejaVu Sans";
export const FONT_ASCENT = 1901 / 2048;
export const FONT_LINE_HEIGHT = (1901 + 483) / 2048;

/** Font size in pixels and box padding for a text item. Shared with the preview. */
export function textMetrics(t: Pick<TextItem, "size">, frameH: number) {
  const fontSize = Math.max(4, Math.round(t.size * frameH));
  return { fontSize, pad: Math.round(fontSize * 0.25) };
}

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

export function buildRender(edits: Edits, opts: RenderOptions): RenderPlan {
  const tmp = opts.tmpDir ?? ".tmp";
  const { source } = edits;
  const W = source.width;
  const H = source.height;
  if (!source.file) throw new Error("edits.json has no source file.");
  if (!(source.duration > 0)) throw new Error("Source duration is unknown — re-create the project.");

  const segments = keepSegments(edits.cuts, source.duration);
  if (segments.length === 0) throw new Error("Everything is cut — nothing left to render.");
  const outDur = outputDuration(segments);

  const inputs: string[][] = [["-i", source.file]];
  const files: HelperFile[] = [];
  const graph: string[] = [];
  let label = 0;
  const next = (prefix: string) => `${prefix}${label++}`;
  let v = "0:v";

  // 1. Region effects -------------------------------------------------------
  for (const r of edits.regions) v = addRegion(graph, v, r, W, H, next);

  // 2. Text -----------------------------------------------------------------
  const texts = edits.texts.filter((t) => t.text.trim());
  let fontFile: string | null = null;
  if (texts.length && (opts.textEngine ?? "drawtext") === "drawtext") {
    fontFile = `${tmp}/font.ttf`;
    for (const t of texts) {
      const textPath = `${tmp}/text_${t.id}.txt`;
      files.push({ path: textPath, content: t.text.replace(/\r\n/g, "\n") });
      const { fontSize, pad } = textMetrics(t, H);
      // drawtext puts the top of the highest glyph at y; shift so the font's ascent line sits at y
      // instead (that matches the CSS preview, and doesn't move when the text changes).
      const yExpr = `${Math.round(t.y * H)}+${n(fontSize * FONT_ASCENT)}-ascent`;
      const parts = [
        `fontfile=${fontFile}`,
        `textfile=${textPath}`,
        "expansion=none",
        `fontsize=${fontSize}`,
        `fontcolor=${hex(t.color)}`,
        `x=${Math.round(t.x * W)}`,
        `y=${yExpr}`,
      ];
      if (t.background) parts.push("box=1", `boxcolor=${hex(t.background)}@${n(t.bgOpacity)}`, `boxborderw=${pad}`);
      parts.push(between(t.start, t.end));
      const out = next("v");
      graph.push(`[${v}]drawtext=${parts.join(":")}[${out}]`);
      v = out;
    }
  } else if (texts.length) {
    // Fallback for FFmpeg builds without drawtext (e.g. the Linux ffmpeg-static binary):
    // one ASS subtitle file rendered by libass, using the same bundled font.
    fontFile = `${tmp}/font.ttf`;
    const assPath = `${tmp}/texts.ass`;
    files.push({ path: assPath, content: buildAss(texts, W, H) });
    const out = next("v");
    graph.push(`[${v}]ass=filename=${assPath}:fontsdir=${tmp}[${out}]`);
    v = out;
  }

  // 3. Images / logos -------------------------------------------------------
  for (const img of edits.images) v = addImage(graph, inputs, v, img, W, H, next);

  // 4. Cuts -----------------------------------------------------------------
  const useSourceAudio = source.hasAudio && !edits.audio.mute;
  let a: string | null = useSourceAudio ? "0:a" : null;
  const whole = segments.length === 1 && segments[0].start <= 0.001 && segments[0].end >= source.duration - 0.001;
  if (!whole) {
    if (segments.length === 1) {
      const s = segments[0];
      const vo = next("v");
      graph.push(`[${v}]trim=start=${n(s.start)}:end=${n(s.end)},setpts=PTS-STARTPTS[${vo}]`);
      v = vo;
      if (a) {
        const ao = next("a");
        graph.push(`[${a}]atrim=start=${n(s.start)}:end=${n(s.end)},asetpts=PTS-STARTPTS[${ao}]`);
        a = ao;
      }
    } else {
      const N = segments.length;
      const vs = segments.map(() => next("vs"));
      graph.push(`[${v}]split=${N}${vs.map((l) => `[${l}]`).join("")}`);
      const as = a ? segments.map(() => next("as")) : [];
      if (a) graph.push(`[${a}]asplit=${N}${as.map((l) => `[${l}]`).join("")}`);
      const pairs: string[] = [];
      segments.forEach((s, i) => {
        const vt = next("vt");
        graph.push(`[${vs[i]}]trim=start=${n(s.start)}:end=${n(s.end)},setpts=PTS-STARTPTS[${vt}]`);
        pairs.push(`[${vt}]`);
        if (a) {
          const at = next("at");
          graph.push(`[${as[i]}]atrim=start=${n(s.start)}:end=${n(s.end)},asetpts=PTS-STARTPTS[${at}]`);
          pairs.push(`[${at}]`);
        }
      });
      const vo = next("v");
      const ao = a ? next("a") : null;
      graph.push(`${pairs.join("")}concat=n=${N}:v=1:a=${a ? 1 : 0}[${vo}]${ao ? `[${ao}]` : ""}`);
      v = vo;
      a = ao;
    }
  }

  // 5. Crop, scale, fades, pixel format --------------------------------------
  const post: string[] = [];
  let curW = evenFloor(W);
  let curH = evenFloor(H);
  if (edits.crop) {
    const c = rectPx(edits.crop, W, H);
    post.push(`crop=${c.w}:${c.h}:${c.x}:${c.y}`);
    curW = c.w;
    curH = c.h;
  } else if (curW !== W || curH !== H) {
    post.push(`crop=${curW}:${curH}:0:0`); // libx264 needs even dimensions
  }
  const height = opts.height !== undefined ? opts.height : edits.export.height;
  if (height && height !== curH) {
    post.push(`scale=-2:${height}`);
    curW = Math.max(2, evenRound((curW * height) / curH));
    curH = height;
  }
  post.push("setsar=1");
  const fadeIn = Math.min(edits.video.fadeIn, outDur);
  const fadeOut = Math.min(edits.video.fadeOut, outDur);
  if (fadeIn > 0) post.push(`fade=t=in:st=0:d=${n(fadeIn)}`);
  if (fadeOut > 0) post.push(`fade=t=out:st=${n(Math.max(0, outDur - fadeOut))}:d=${n(fadeOut)}`);
  post.push("format=yuv420p");
  graph.push(`[${v}]${post.join(",")}[vout]`);

  // 6. Audio ----------------------------------------------------------------
  const music = edits.audio.music;
  let audioOut: string | null = null;
  const aChain: string[] = [];
  if (a && edits.audio.volume !== 1) aChain.push(`volume=${n(edits.audio.volume)}`);
  if (music) {
    const idx = inputs.length;
    inputs.push(music.loop ? ["-stream_loop", "-1", "-i", music.file] : ["-i", music.file]);
    const m = next("m");
    graph.push(
      `[${idx}:a]atrim=end=${n(outDur)},asetpts=PTS-STARTPTS,volume=${n(music.volume)},` +
        `aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${n(outDur)}[${m}]`,
    );
    if (a) {
      const s = next("a");
      graph.push(`[${a}]${[...aChain, "aresample=48000", "aformat=channel_layouts=stereo"].join(",")}[${s}]`);
      const mixed = next("a");
      graph.push(`[${s}][${m}]amix=inputs=2:duration=first:normalize=0[${mixed}]`);
      a = mixed;
    } else {
      a = m;
    }
    aChain.length = 0;
  }
  if (a) {
    const aFadeIn = Math.min(edits.audio.fadeIn, outDur);
    const aFadeOut = Math.min(edits.audio.fadeOut, outDur);
    if (aFadeIn > 0) aChain.push(`afade=t=in:st=0:d=${n(aFadeIn)}`);
    if (aFadeOut > 0) aChain.push(`afade=t=out:st=${n(Math.max(0, outDur - aFadeOut))}:d=${n(aFadeOut)}`);
    if (aChain.length === 0) aChain.push("anull");
    graph.push(`[${a}]${aChain.join(",")}[aout]`);
    audioOut = "aout";
  }

  // Output ------------------------------------------------------------------
  const filterGraph = graph.join(";");
  const graphArgs: string[] = [];
  if (filterGraph.length > 6000) {
    // Very long graphs can exceed the Windows command-line limit: pass them in a file.
    const graphFile = `${tmp}/graph.txt`;
    files.push({ path: graphFile, content: filterGraph });
    graphArgs.push("-filter_complex_script", graphFile);
  } else {
    graphArgs.push("-filter_complex", filterGraph);
  }

  const quality = opts.quality ?? edits.export.quality;
  const args = [
    "-y",
    ...inputs.flat(),
    ...graphArgs,
    "-map",
    "[vout]",
    ...(audioOut ? ["-map", `[${audioOut}]`] : ["-an"]),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    String(CRF[quality]),
    "-r",
    n(source.fps),
    ...(audioOut ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-map_metadata",
    "-1", // drop source metadata (phone videos often carry GPS location)
    "-max_muxing_queue_size",
    "4096",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    opts.outputFile,
  ];

  return { args, filterGraph, files, fontFile, segments, outputDuration: outDur, outWidth: curW, outHeight: curH };
}

function addRegion(graph: string[], v: string, r: Region, W: number, H: number, next: (p: string) => string): string {
  const p = rectPx(r, W, H);
  const en = between(r.start, r.end);
  const out = next("v");
  if (r.type === "box") {
    graph.push(`[${v}]drawbox=x=${p.x}:y=${p.y}:w=${p.w}:h=${p.h}:color=${hex(r.color)}@1:t=fill:${en}[${out}]`);
    return out;
  }
  const base = next("b");
  const tmp = next("c");
  const fx = next("f");
  let effect: string;
  if (r.type === "blur") {
    const { luma, chroma } = blurRadii(r.strength, p.w, p.h, H);
    effect = `boxblur=luma_radius=${luma}:luma_power=2:chroma_radius=${chroma}:chroma_power=2:${en}`;
  } else {
    const b = pixelBlock(r.strength, H);
    const sw = Math.max(1, Math.round(p.w / b));
    const sh = Math.max(1, Math.round(p.h / b));
    effect = `scale=${sw}:${sh}:flags=area,scale=${p.w}:${p.h}:flags=neighbor`;
  }
  graph.push(`[${v}]split=2[${base}][${tmp}]`);
  graph.push(`[${tmp}]crop=${p.w}:${p.h}:${p.x}:${p.y},${effect}[${fx}]`);
  graph.push(`[${base}][${fx}]overlay=x=${p.x}:y=${p.y}:${en}[${out}]`);
  return out;
}

function addImage(
  graph: string[],
  inputs: string[][],
  v: string,
  img: ImageItem,
  W: number,
  H: number,
  next: (p: string) => string,
): string {
  const idx = inputs.length;
  inputs.push(["-i", img.file]);
  const pw = Math.max(2, evenRound(img.w * W));
  const chain = [`scale=${pw}:-1`, "format=rgba"];
  if (img.opacity < 1) chain.push(`colorchannelmixer=aa=${n(img.opacity)}`);
  const il = next("i");
  const out = next("v");
  graph.push(`[${idx}:v]${chain.join(",")}[${il}]`);
  graph.push(
    `[${v}][${il}]overlay=x=${Math.round(img.x * W)}:y=${Math.round(img.y * H)}:eof_action=repeat:${between(img.start, img.end)}[${out}]`,
  );
  return out;
}

/** ASS colour: &HAABBGGRR, where alpha 00 = opaque. */
function assColor(c: string, opacity = 1): string {
  const h = c.replace("#", "");
  const a = Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, "0");
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(t: number): string {
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Escape text for an ASS Dialogue line (no override tags, keep backslashes and braces literal). */
function assText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\u200b")
    .replace(/[{}]/g, (ch) => "\\" + ch)
    .replace(/\n/g, "\\N");
}

/** Build an ASS subtitle file for the text items (pixel coordinates, top-left aligned). */
export function buildAss(texts: TextItem[], W: number, H: number): string {
  const styles: string[] = [];
  const events: string[] = [];
  for (const t of texts) {
    const { fontSize, pad } = textMetrics(t, H);
    // libass sizes fonts by line height (ascent + descent), drawtext/CSS by em size.
    const assSize = n(fontSize * FONT_LINE_HEIGHT);
    const box = t.background ? 3 : 1;
    const outlineColor = t.background ? assColor(t.background, t.bgOpacity) : "&HFF000000";
    styles.push(
      `Style: ${t.id},${FONT_FAMILY},${assSize},${assColor(t.color)},${assColor(t.color)},${outlineColor},&HFF000000,` +
        `0,0,0,0,100,100,0,0,${box},${t.background ? pad : 0},0,7,0,0,0,1`,
    );
    events.push(
      `Dialogue: 0,${assTime(t.start)},${assTime(t.end)},${t.id},,0,0,0,,{\\pos(${Math.round(t.x * W)},${Math.round(t.y * H)})}${assText(t.text)}`,
    );
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
