/**
 * Timeline math shared by the renderer and the UI (browser-safe, no Node imports).
 *
 * The source timeline is the original video. Cuts remove ranges from it; what
 * is left are the KEEP segments, played back to back to form the output timeline.
 */
import type { Cut } from "./schema";

export interface Segment {
  start: number;
  end: number;
}

/** Segments shorter than this are dropped (they would only produce glitches). */
export const MIN_SEGMENT = 0.05;

/** Sort, clamp and merge cut ranges (overlapping or touching cuts become one). */
export function mergeCuts(cuts: Pick<Cut, "start" | "end">[], duration: number): Segment[] {
  const sorted = cuts
    .map((c) => ({ start: Math.max(0, Math.min(c.start, c.end)), end: Math.min(duration, Math.max(c.start, c.end)) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const merged: Segment[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  return merged;
}

/** The parts of the source that survive the cuts, in order. */
export function keepSegments(cuts: Pick<Cut, "start" | "end">[], duration: number): Segment[] {
  const keep: Segment[] = [];
  let pos = 0;
  for (const c of mergeCuts(cuts, duration)) {
    if (c.start - pos >= MIN_SEGMENT) keep.push({ start: pos, end: c.start });
    pos = c.end;
  }
  if (duration - pos >= MIN_SEGMENT) keep.push({ start: pos, end: duration });
  return keep;
}

export function outputDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/** Map a source time to the output timeline (null if the moment was cut). */
export function sourceToOutput(t: number, segments: Segment[]): number | null {
  let acc = 0;
  for (const s of segments) {
    if (t >= s.start && t <= s.end) return acc + (t - s.start);
    acc += s.end - s.start;
  }
  return null;
}

/** If t falls inside a cut, return where playback should jump to; otherwise null. */
export function skipCut(t: number, cuts: Pick<Cut, "start" | "end">[], duration: number): number | null {
  for (const c of mergeCuts(cuts, duration)) {
    if (t >= c.start && t < c.end - 0.01) return c.end;
  }
  return null;
}
