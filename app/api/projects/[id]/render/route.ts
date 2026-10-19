/**
 * POST   /api/projects/<id>/render  body = { height?, quality?, filename? }  -> start a render job
 * GET    /api/projects/<id>/render  -> { job, exports }  (poll this for progress)
 * DELETE /api/projects/<id>/render  -> cancel the running render
 *
 * Uses the same renderProject() as `npm run render`, so results are identical.
 */
import { renderProject } from "@/lib/export";
import { getJob, startJob, cancelJob } from "@/lib/jobs";
import { listExports, projectExists, HttpError } from "@/lib/storage";
import { EXPORT_HEIGHTS, QUALITIES, type ExportHeight, type Quality } from "@/lib/schema";
import { json, errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!(await projectExists(id))) throw new HttpError(404, "Project not found");
    const body = (await req.json().catch(() => ({}))) as { height?: unknown; quality?: unknown; filename?: unknown };
    const height = body.height === undefined ? undefined : EXPORT_HEIGHTS.includes(body.height as ExportHeight) ? (body.height as ExportHeight) : null;
    const quality = QUALITIES.includes(body.quality as Quality) ? (body.quality as Quality) : undefined;
    const filename = typeof body.filename === "string" ? body.filename : undefined;
    if (getJob(id, "render")?.state === "running") throw new HttpError(409, "A render is already running for this project.");
    const job = startJob(id, "render", ({ progress, log, signal }) =>
      renderProject(id, { height, quality, filename, onProgress: progress, onLog: log, signal }),
    );
    return json({ job }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return json({ job: getJob(id, "render") ?? null, exports: await listExports(id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return json({ canceled: cancelJob(id, "render") });
  } catch (e) {
    return errorResponse(e);
  }
}
