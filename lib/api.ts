/** Small helpers shared by the API route handlers. */
import { HttpError } from "./storage";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Turn any thrown error into a JSON error response. */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  const message = e instanceof Error ? e.message : String(e);
  console.error("[clipforge]", message);
  return json({ error: message }, 500);
}
