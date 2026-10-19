/**
 * GET  /api/projects          -> list projects (newest first)
 * POST /api/projects {name}   -> create an empty project folder, returns {id}
 *                                (then upload the video with PUT /api/projects/<id>/upload?kind=source)
 */
import { createProjectDir, listProjects } from "@/lib/storage";
import { json, errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ projects: await listProjects() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const id = await createProjectDir(typeof body.name === "string" && body.name.trim() ? body.name : "project");
    return json({ id }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
