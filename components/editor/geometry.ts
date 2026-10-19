/** Rectangle math for drawing, moving and resizing items on the stage (normalized 0–1 units). */
import type { CSSProperties } from "react";
import { clamp, MIN_SIZE, round3 } from "@/lib/schema";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const CORNERS: Handle[] = ["nw", "ne", "sw", "se"];
export const ALL_HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function roundRect(r: Rect): Rect {
  return { x: round3(r.x), y: round3(r.y), w: round3(r.w), h: round3(r.h) };
}

export function moveRect(r0: Rect, dx: number, dy: number): Rect {
  return roundRect({ ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) });
}

/** Rect from two points (drawing). */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  const x = clamp(Math.min(ax, bx), 0, 1);
  const y = clamp(Math.min(ay, by), 0, 1);
  return { x, y, w: clamp(Math.abs(bx - ax), 0, 1 - x), h: clamp(Math.abs(by - ay), 0, 1 - y) };
}

/**
 * Resize with a handle. `ratio` (optional) locks w/h in NORMALIZED units
 * (for a pixel aspect A on a W×H frame, ratio = A * H / W).
 */
export function resizeRect(r0: Rect, handle: Handle, dx: number, dy: number, ratio?: number | null, min = MIN_SIZE): Rect {
  if (ratio) {
    const hasW = handle.includes("w");
    const hasE = handle.includes("e");
    const hasN = handle.includes("n");
    const hasS = handle.includes("s");
    const ax = hasW ? r0.x + r0.w : hasE ? r0.x : r0.x + r0.w / 2;
    const ay = hasN ? r0.y + r0.h : hasS ? r0.y : r0.y + r0.h / 2;
    let w = handle === "n" || handle === "s" ? (r0.h + (hasN ? -dy : dy)) * ratio : r0.w + (hasW ? -dx : dx);
    const availW = hasW ? ax : hasE ? 1 - ax : 2 * Math.min(ax, 1 - ax);
    const availH = hasN ? ay : hasS ? 1 - ay : 2 * Math.min(ay, 1 - ay);
    w = clamp(w, min, Math.max(min, Math.min(availW, availH * ratio)));
    const h = w / ratio;
    const x = hasW ? ax - w : hasE ? ax : ax - w / 2;
    const y = hasN ? ay - h : hasS ? ay : ay - h / 2;
    return roundRect({ x: clamp(x, 0, 1), y: clamp(y, 0, 1), w, h });
  }
  let { x, y, w, h } = r0;
  const right = r0.x + r0.w;
  const bottom = r0.y + r0.h;
  if (handle.includes("w")) {
    x = clamp(r0.x + dx, 0, right - min);
    w = right - x;
  }
  if (handle.includes("e")) w = clamp(r0.w + dx, min, 1 - r0.x);
  if (handle.includes("n")) {
    y = clamp(r0.y + dy, 0, bottom - min);
    h = bottom - y;
  }
  if (handle.includes("s")) h = clamp(r0.h + dy, min, 1 - r0.y);
  return roundRect({ x, y, w, h });
}

/** Largest centered rect with the given pixel aspect ratio on a W×H frame. */
export function fitAspect(aspect: number, W: number, H: number): Rect {
  const ratio = (aspect * H) / W; // normalized w/h
  const w = ratio <= 1 ? ratio : 1;
  const h = ratio <= 1 ? 1 : 1 / ratio;
  return roundRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** CSS position for a handle on a box. */
export function handleStyle(h: Handle): CSSProperties {
  const s: CSSProperties = { position: "absolute", width: 10, height: 10, cursor: HANDLE_CURSOR[h] };
  s.left = h.includes("w") ? -5 : h.includes("e") ? undefined : "calc(50% - 5px)";
  s.right = h.includes("e") ? -5 : undefined;
  s.top = h.includes("n") ? -5 : h.includes("s") ? undefined : "calc(50% - 5px)";
  s.bottom = h.includes("s") ? -5 : undefined;
  return s;
}
