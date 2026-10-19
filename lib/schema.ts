/**
 * edits.json schema (v1) — the single source of truth for a project.
 *
 * Conventions (see CLAUDE.md for the full write-up):
 *  - Times are SECONDS on the ORIGINAL source timeline (cuts, regions, texts, images).
 *    Exceptions: video/audio fades and music apply to the OUTPUT (after cuts).
 *  - Positions and sizes are NORMALIZED 0–1 relative to the source frame
 *    (x = 0 is the left edge, y = 0 is the top edge, w = 1 is the full width).
 *
 * This file must stay free of Node-only imports: it is used by the browser UI,
 * the API routes, the CLI scripts and the tests.
 */

export const SCHEMA_VERSION = 1;

export type RegionType = "blur" | "pixelate" | "box";
export type Quality = "high" | "medium" | "small";
export type ExportHeight = null | 1080 | 720 | 480;

export interface SourceInfo {
  /** File name inside the project folder, e.g. "source.mp4". */
  file: string;
  /** Display width/height (already swapped for rotated phone videos). */
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
}

export interface Cut {
  id: string;
  /** Range to REMOVE, in source seconds. */
  start: number;
  end: number;
}

export interface Region {
  id: string;
  type: RegionType;
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  end: number;
  /** 1–100. Blur radius / pixel block size. Ignored for "box". */
  strength: number;
  /** "#rrggbb", used by "box". */
  color: string;
  label?: string;
}

export interface TextItem {
  id: string;
  text: string;
  /** Top-left corner of the text, normalized. */
  x: number;
  y: number;
  /** Font size as a fraction of the source video height (0.05 = 5%). */
  size: number;
  color: string;
  /** Background box color ("#rrggbb") or null for no box. */
  background: string | null;
  /** 0–1 */
  bgOpacity: number;
  start: number;
  end: number;
}

export interface ImageItem {
  id: string;
  /** Path inside the project folder, always "assets/<name>". */
  file: string;
  x: number;
  y: number;
  /** Width as a fraction of the source width. Height follows the image's aspect ratio. */
  w: number;
  /** 0–1 */
  opacity: number;
  start: number;
  end: number;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Music {
  /** "assets/<name>" */
  file: string;
  /** 0–4 (1 = original loudness) */
  volume: number;
  loop: boolean;
}

export interface Edits {
  version: 1;
  /** Optional human-friendly project name (shown on the home page). */
  name?: string;
  source: SourceInfo;
  cuts: Cut[];
  regions: Region[];
  texts: TextItem[];
  images: ImageItem[];
  crop: Crop | null;
  video: { fadeIn: number; fadeOut: number };
  audio: {
    mute: boolean;
    /** 0–4 (1 = original loudness) */
    volume: number;
    fadeIn: number;
    fadeOut: number;
    music: Music | null;
  };
  export: { height: ExportHeight; quality: Quality; filename?: string };
}

export const EXPORT_HEIGHTS: ExportHeight[] = [null, 1080, 720, 480];
export const QUALITIES: Quality[] = ["high", "medium", "small"];
export const REGION_TYPES: RegionType[] = ["blur", "pixelate", "box"];

/** Smallest region/crop size, as a fraction of the frame. */
export const MIN_SIZE = 0.01;
/** Default length of a new item, in seconds. */
export const DEFAULT_ITEM_LENGTH = 5;

export const DEFAULTS = {
  regionStrength: 50,
  boxColor: "#000000",
  textSize: 0.06,
  textColor: "#ffffff",
  textBgOpacity: 0.6,
  imageWidth: 0.15,
  imageOpacity: 1,
  musicVolume: 0.3,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Round to 3 decimals so edits.json stays readable. */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Parse a time value. Accepts numbers (seconds) and strings like
 * "80", "1:20", "1:20.5", "01:02:03" — handy when people or AIs edit JSON by hand.
 */
export function parseTime(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (/^-?\d+(\.\d+)?s?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

/** Format seconds as m:ss.mmm (or h:mm:ss.mmm). */
export function formatTime(t: number, decimals = 2): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t - h * 3600 - m * 60;
  const ss = s.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  gray: "#808080",
  grey: "#808080",
  pink: "#ffc0cb",
  purple: "#800080",
};

/** Normalize a color to "#rrggbb", or return the fallback. */
export function normalizeColor(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  let s = v.trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  if (s.startsWith("0x")) s = "#" + s.slice(2);
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  return fallback;
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Make a safe "assets/<name>" path; returns null for anything suspicious. */
export function normalizeAssetPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!s) return null;
  if (!s.startsWith("assets/")) s = "assets/" + s;
  if (s.split("/").some((part) => part === ".." || part === "")) return null;
  if (/[:*?"<>|]/.test(s)) return null;
  return s;
}

/** Sanitize an export file name (no folders, no extension needed). */
export function sanitizeFilename(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v
    .trim()
    .replace(/\.mp4$/i, "")
    .replace(/[^a-zA-Z0-9 _\-.()]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return s || undefined;
}

// ---------------------------------------------------------------------------
// normalize()
// ---------------------------------------------------------------------------

/** Clamp a [start, end] pair to the source duration; fix reversed or empty ranges. */
function normRange(rawStart: unknown, rawEnd: unknown, duration: number): [number, number] {
  const max = duration > 0 ? duration : Infinity;
  let start = parseTime(rawStart) ?? 0;
  let end = parseTime(rawEnd) ?? (duration > 0 ? duration : start + DEFAULT_ITEM_LENGTH);
  if (end < start) [start, end] = [end, start];
  start = clamp(start, 0, max);
  end = clamp(end, 0, max);
  if (end - start < 0.01) {
    // Zero-length range: give it some length so it is visible and editable.
    end = Math.min(max, start + 1);
    if (end - start < 0.01) start = Math.max(0, end - 1);
  }
  return [round3(start), round3(end)];
}

/** Normalize a rectangle so it stays inside the frame. */
function normRect(r: Record<string, unknown>, def = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }) {
  const w = round3(num(r.w, def.w, MIN_SIZE, 1));
  const h = round3(num(r.h, def.h, MIN_SIZE, 1));
  const x = round3(num(r.x, def.x, 0, 1 - w));
  const y = round3(num(r.y, def.y, 0, 1 - h));
  return { x, y, w, h };
}

function uniqueId(raw: unknown, prefix: string, used: Set<string>): string {
  let id = typeof raw === "string" ? raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) : "";
  if (!id || used.has(id)) {
    do id = newId(prefix);
    while (used.has(id));
  }
  used.add(id);
  return id;
}

/**
 * Turn anything (partial, hand-written, outdated JSON) into a valid Edits object.
 * Never throws. Fills missing fields, clamps values, adds missing ids.
 */
export function normalize(input: unknown): Edits {
  const root = obj(input);
  const src = obj(root.source);
  const duration = num(src.duration, 0, 0);
  const source: SourceInfo = {
    file: typeof src.file === "string" ? src.file : "",
    width: Math.round(num(src.width, 1920, 2, 16384)),
    height: Math.round(num(src.height, 1080, 2, 16384)),
    duration: round3(duration),
    fps: num(src.fps, 30, 1, 240),
    hasAudio: src.hasAudio === undefined ? true : !!src.hasAudio,
    codec: typeof src.codec === "string" ? src.codec : "",
  };

  const used = new Set<string>();

  const cuts: Cut[] = arr(root.cuts).map((c) => {
    const o = obj(c);
    const [start, end] = normRange(o.start, o.end, duration);
    return { id: uniqueId(o.id, "cut", used), start, end };
  });

  const regions: Region[] = arr(root.regions).map((r) => {
    const o = obj(r);
    const [start, end] = normRange(o.start, o.end, duration);
    const type = REGION_TYPES.includes(o.type as RegionType) ? (o.type as RegionType) : "blur";
    const region: Region = {
      id: uniqueId(o.id, type, used),
      type,
      ...normRect(o),
      start,
      end,
      strength: Math.round(num(o.strength, DEFAULTS.regionStrength, 1, 100)),
      color: normalizeColor(o.color, DEFAULTS.boxColor),
    };
    if (typeof o.label === "string" && o.label.trim()) region.label = o.label.slice(0, 80);
    return region;
  });

  const texts: TextItem[] = arr(root.texts).map((t) => {
    const o = obj(t);
    const [start, end] = normRange(o.start, o.end, duration);
    const bg = o.background;
    return {
      id: uniqueId(o.id, "text", used),
      text: typeof o.text === "string" ? o.text : String(o.text ?? "Text"),
      x: round3(num(o.x, 0.05, 0, 1)),
      y: round3(num(o.y, 0.05, 0, 1)),
      size: round3(num(o.size, DEFAULTS.textSize, 0.01, 0.5)),
      color: normalizeColor(o.color, DEFAULTS.textColor),
      background: bg === null || bg === undefined || bg === false || bg === "" ? null : normalizeColor(bg, "#000000"),
      bgOpacity: round3(num(o.bgOpacity, DEFAULTS.textBgOpacity, 0, 1)),
      start,
      end,
    };
  });

  const images: ImageItem[] = [];
  for (const i of arr(root.images)) {
    const o = obj(i);
    const file = normalizeAssetPath(o.file);
    if (!file) continue; // an image without a usable file cannot be rendered
    const [start, end] = normRange(o.start, o.end, duration);
    const w = round3(num(o.w, DEFAULTS.imageWidth, MIN_SIZE, 1));
    images.push({
      id: uniqueId(o.id, "image", used),
      file,
      x: round3(num(o.x, 1 - w - 0.03, 0, 1)),
      y: round3(num(o.y, 0.03, 0, 1)),
      w,
      opacity: round3(num(o.opacity, DEFAULTS.imageOpacity, 0, 1)),
      start,
      end,
    });
  }

  const cropRaw = root.crop;
  const crop: Crop | null =
    cropRaw && typeof cropRaw === "object" ? normRect(obj(cropRaw), { x: 0, y: 0, w: 1, h: 1 }) : null;

  const video = obj(root.video);
  const audio = obj(root.audio);
  const musicRaw = obj(audio.music);
  const musicFile = normalizeAssetPath(musicRaw.file);
  const exp = obj(root.export);
  const height = EXPORT_HEIGHTS.includes(Number(exp.height) as ExportHeight) ? (Number(exp.height) as ExportHeight) : null;

  const edits: Edits = {
    version: SCHEMA_VERSION,
    source,
    cuts,
    regions,
    texts,
    images,
    crop: crop && crop.w >= 0.999 && crop.h >= 0.999 ? null : crop,
    video: {
      fadeIn: round3(num(video.fadeIn, 0, 0, 30)),
      fadeOut: round3(num(video.fadeOut, 0, 0, 30)),
    },
    audio: {
      mute: !!audio.mute,
      volume: round3(num(audio.volume, 1, 0, 4)),
      fadeIn: round3(num(audio.fadeIn, 0, 0, 30)),
      fadeOut: round3(num(audio.fadeOut, 0, 0, 30)),
      music: musicFile
        ? {
            file: musicFile,
            volume: round3(num(musicRaw.volume, DEFAULTS.musicVolume, 0, 4)),
            loop: musicRaw.loop === undefined ? true : !!musicRaw.loop,
          }
        : null,
    },
    export: {
      height: exp.height === null || exp.height === undefined ? null : height,
      quality: QUALITIES.includes(exp.quality as Quality) ? (exp.quality as Quality) : "high",
    },
  };
  const filename = sanitizeFilename(exp.filename);
  if (filename) edits.export.filename = filename;
  if (typeof root.name === "string" && root.name.trim()) edits.name = root.name.trim().slice(0, 120);
  return edits;
}

/** A fresh edits.json for a newly probed source. */
export function defaultEdits(source: SourceInfo, name?: string): Edits {
  return normalize({ name, source });
}
