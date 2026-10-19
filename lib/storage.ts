/**
 * Project storage (server/CLI only). Everything lives in the local `projects/` folder:
 *
 *   projects/<projectId>/
 *     source.<ext>   the original video (never modified)
 *     edits.json     the single source of truth for the edit
 *     assets/        logos, images, music
 *     thumbs.jpg     thumbnail strip for the timeline
 *     preview.mp4    browser-friendly proxy (only for HEVC/ProRes/10-bit sources)
 *     exports/       rendered MP4s
 *     .tmp/          scratch files for FFmpeg
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { normalize, type Edits } from "./schema";

/** Root folder of the app (where package.json and public/ live). */
export const APP_ROOT = process.env.CLIPFORGE_ROOT || process.cwd();
export const PROJECTS_DIR = process.env.CLIPFORGE_PROJECTS_DIR || path.join(APP_ROOT, "projects");
export const FONT_FILE = path.join(APP_ROOT, "public", "fonts", "DejaVuSans.ttf");

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/;

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

export function projectDir(id: string): string {
  if (!isValidId(id)) throw new HttpError(400, "Invalid project id");
  return path.join(PROJECTS_DIR, id);
}

/** An error with an HTTP status, so API routes can answer with the right code. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolve a path inside a project folder. Rejects absolute paths and `..` tricks,
 * so an API caller can never read or write outside the project.
 */
export function resolveInProject(id: string, rel: string): string {
  const dir = projectDir(id);
  const clean = rel.replace(/\\/g, "/");
  if (!clean || clean.includes("\0") || path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) {
    throw new HttpError(400, "Invalid path");
  }
  const full = path.resolve(dir, clean);
  const relative = path.relative(dir, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(400, "Invalid path");
  return full;
}

export function editsPath(id: string): string {
  return path.join(projectDir(id), "edits.json");
}

export async function projectExists(id: string): Promise<boolean> {
  try {
    return (await fsp.stat(editsPath(id))).isFile();
  } catch {
    return false;
  }
}

export async function readEdits(id: string): Promise<{ edits: Edits; mtime: number }> {
  const file = editsPath(id);
  let text: string;
  let mtime: number;
  try {
    text = await fsp.readFile(file, "utf8");
    mtime = (await fsp.stat(file)).mtimeMs;
  } catch {
    throw new HttpError(404, "Project not found");
  }
  let raw: unknown = {};
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    // A half-typed hand edit: keep serving the last good state instead of crashing.
    throw new HttpError(422, `edits.json is not valid JSON: ${(e as Error).message}`);
  }
  return { edits: normalize(raw), mtime };
}

/** Normalize and write edits.json atomically (temp file + rename). Returns the new mtime. */
export async function writeEdits(id: string, edits: unknown): Promise<{ edits: Edits; mtime: number }> {
  const normalized = normalize(edits);
  const file = editsPath(id);
  const text = JSON.stringify(normalized, null, 2) + "\n";
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, text, "utf8");
  try {
    await fsp.rename(tmp, file);
  } catch {
    // Windows can refuse to replace a file another program holds open; fall back to a plain write.
    await fsp.writeFile(file, text, "utf8");
    await fsp.rm(tmp, { force: true });
  }
  return { edits: normalized, mtime: (await fsp.stat(file)).mtimeMs };
}

/** Make a readable, unique project id from a name, e.g. "my-trip-2024". */
export async function createProjectDir(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project";
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    try {
      await fsp.mkdir(path.join(PROJECTS_DIR, id));
      for (const sub of ["assets", "exports", ".tmp"]) await fsp.mkdir(path.join(PROJECTS_DIR, id, sub), { recursive: true });
      return id;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  mtime: number;
  hasThumbs: boolean;
  ready: boolean;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isValidId(e.name)) continue;
    const dir = path.join(PROJECTS_DIR, e.name);
    let summary: ProjectSummary = {
      id: e.name,
      name: e.name,
      duration: 0,
      width: 0,
      height: 0,
      mtime: 0,
      hasThumbs: fs.existsSync(path.join(dir, "thumbs.jpg")),
      ready: false,
    };
    try {
      const { edits, mtime } = await readEdits(e.name);
      summary = {
        ...summary,
        name: edits.name || e.name,
        duration: edits.source.duration,
        width: edits.source.width,
        height: edits.source.height,
        mtime,
        ready: !!edits.source.file,
      };
    } catch {
      try {
        summary.mtime = (await fsp.stat(dir)).mtimeMs;
      } catch {
        /* ignore */
      }
    }
    out.push(summary);
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function deleteProject(id: string): Promise<void> {
  await fsp.rm(projectDir(id), { recursive: true, force: true });
}

/** List rendered files in exports/, newest first. */
export async function listExports(id: string) {
  const dir = path.join(projectDir(id), "exports");
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (!/\.mp4$/i.test(name) || name.startsWith(".")) continue;
    const st = await fsp.stat(path.join(dir, name));
    files.push({ name, path: `exports/${name}`, size: st.size, mtime: st.mtimeMs });
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

/** Make a file name safe to store in assets/ (keeps the extension). */
export function safeAssetName(name: string): string {
  const ext = (path.extname(name) || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  const base =
    path
      .basename(name, path.extname(name))
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "asset";
  return base + ext;
}
