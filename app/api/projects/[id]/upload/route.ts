/**
 * PUT /api/projects/<id>/upload?kind=source&name=<file name>   body = raw file bytes
 * PUT /api/projects/<id>/upload?kind=asset&name=<file name>    (logos, images, music -> assets/)
 *
 * The request body is STREAMED to disk, never buffered in memory, so 1 GB+ videos are fine.
 * For a source video: probe it, write a default edits.json, then make thumbnails and
 * (for HEVC/ProRes/10-bit) a browser preview in the background.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { projectDir, safeAssetName, HttpError } from "@/lib/storage";
import { installSource } from "@/lib/media";
import { json, errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const ASSET_EXT = /\.(png|jpe?g|webp|gif|bmp|mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;

type Ctx = { params: Promise<{ id: string }> };

async function streamToFile(req: Request, file: string) {
  if (!req.body) throw new HttpError(400, "Empty upload");
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebStream<Uint8Array>), fs.createWriteStream(file));
  } catch (e) {
    await fsp.rm(file, { force: true });
    throw e;
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) throw new HttpError(404, "Project not found");
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const name = url.searchParams.get("name") || "upload";

    if (kind === "source") {
      await fsp.mkdir(path.join(dir, ".tmp"), { recursive: true });
      const tmp = path.join(dir, ".tmp", `upload-${Date.now()}`);
      await streamToFile(req, tmp);
      try {
        const { edits, needsPreview } = await installSource(id, tmp, name);
        return json({ edits, needsPreview });
      } catch (e) {
        await fsp.rm(tmp, { force: true });
        throw new HttpError(422, (e as Error).message);
      }
    }

    if (kind === "asset") {
      if (!ASSET_EXT.test(name)) throw new HttpError(400, "Unsupported file type. Use PNG/JPG/WebP/GIF images or MP3/WAV/M4A/OGG/FLAC audio.");
      await fsp.mkdir(path.join(dir, "assets"), { recursive: true });
      const safe = safeAssetName(name);
      const ext = path.extname(safe);
      let final = safe;
      for (let i = 2; fs.existsSync(path.join(dir, "assets", final)); i++) final = `${path.basename(safe, ext)}-${i}${ext}`;
      const tmp = path.join(dir, "assets", `.${final}.partial`);
      await streamToFile(req, tmp);
      await fsp.rename(tmp, path.join(dir, "assets", final));
      return json({ file: `assets/${final}` }, 201);
    }

    throw new HttpError(400, "kind must be 'source' or 'asset'");
  } catch (e) {
    return errorResponse(e);
  }
}
