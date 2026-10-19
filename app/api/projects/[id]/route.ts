/**
 * GET    /api/projects/<id>          -> { edits, mtime, media }   (media = what to play, thumbnail/preview status)
 * GET    /api/projects/<id>?meta=1   -> { mtime, media, invalid? } (cheap; the editor polls this for live sync.
 *                                       invalid = JSON error message while edits.json is being hand-edited)
 * PUT    /api/projects/<id>          -> body = edits; saves the normalized edits, returns { edits, mtime }
 * DELETE /api/projects/<id>          -> deletes the whole project folder
 */
import fsp from "node:fs/promises";
import { readEdits, writeEdits, deleteProject, editsPath, projectExists, HttpError } from "@/lib/storage";
import { mediaStatus } from "@/lib/media";
import { cancelProjectJobs } from "@/lib/jobs";
import { json, errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (new URL(req.url).searchParams.get("meta")) {
      let mtime = 0;
      try {
        mtime = (await fsp.stat(editsPath(id))).mtimeMs;
      } catch {
        throw new HttpError(404, "Project not found");
      }
      try {
        const { edits } = await readEdits(id);
        return json({ mtime, media: mediaStatus(id, edits) });
      } catch (e) {
        return json({ mtime, media: null, invalid: (e as Error).message });
      }
    }
    const { edits, mtime } = await readEdits(id);
    return json({ id, edits, mtime, media: mediaStatus(id, edits) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!(await projectExists(id))) throw new HttpError(404, "Project not found");
    const body = await req.json().catch(() => {
      throw new HttpError(400, "Body must be JSON");
    });
    const { edits: current } = await readEdits(id).catch(() => ({ edits: null }));
    // The source block is written by probing; never let a client change it by accident.
    const next = current ? { ...(body as object), source: current.source } : body;
    const saved = await writeEdits(id, next);
    return json(saved);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    cancelProjectJobs(id);
    await deleteProject(id);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
