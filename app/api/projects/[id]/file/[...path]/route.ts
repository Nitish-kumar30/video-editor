/**
 * GET /api/projects/<id>/file/<path inside the project>[?download=1]
 *
 * Serves project files (video, thumbnails, assets, exports) with HTTP Range support,
 * which the <video> element needs for seeking. Paths are resolved safely inside the
 * project folder (no "../" escapes). ?download=1 makes the browser save the file.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveInProject, HttpError } from "@/lib/storage";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".json": "application/json",
};

type Ctx = { params: Promise<{ id: string; path: string[] }> };

function toWeb(stream: fs.ReadStream): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream;
}

async function serve(req: Request, { params }: Ctx, headOnly: boolean) {
  try {
    const { id, path: parts } = await params;
    const file = resolveInProject(id, parts.map(decodeURIComponent).join("/"));
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
    } catch {
      throw new HttpError(404, "File not found");
    }
    if (!stat.isFile()) throw new HttpError(404, "File not found");

    const headers = new Headers({
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Last-Modified": stat.mtime.toUTCString(),
    });
    if (new URL(req.url).searchParams.get("download")) {
      const name = path.basename(file);
      headers.set("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }

    const size = stat.size;
    const range = req.headers.get("range");
    const m = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && m && (m[1] || m[2])) {
      let start: number, end: number;
      if (m[1]) {
        start = parseInt(m[1], 10);
        end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      } else {
        start = Math.max(0, size - parseInt(m[2], 10)); // "bytes=-500" = last 500 bytes
        end = size - 1;
      }
      if (start >= size || start > end) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      headers.set("Content-Length", String(end - start + 1));
      if (headOnly) return new Response(null, { status: 206, headers });
      return new Response(toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
    }

    headers.set("Content-Length", String(size));
    if (headOnly) return new Response(null, { status: 200, headers });
    return new Response(toWeb(fs.createReadStream(file)), { status: 200, headers });
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET(req: Request, ctx: Ctx) {
  return serve(req, ctx, false);
}

export function HEAD(req: Request, ctx: Ctx) {
  return serve(req, ctx, true);
}
