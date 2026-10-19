import type { Edits } from "@/lib/schema";

export type Tool = "select" | "blur" | "pixelate" | "box" | "text" | "image" | "crop";

/** What is selected in the editor. `crop` has no id (there is only one crop). */
export type Selection =
  | { kind: "region"; id: string }
  | { kind: "text"; id: string }
  | { kind: "image"; id: string }
  | { kind: "cut"; id: string }
  | { kind: "crop" }
  | null;

/**
 * Update the edits. Pass a `coalesce` key to merge rapid changes (a drag, typing in a
 * field) into one undo step: consecutive updates with the same key replace each other.
 */
export type UpdateEdits = (fn: (draft: Edits) => Edits, coalesce?: string) => void;

export interface MediaStatus {
  videoFile: string;
  usingPreview: boolean;
  preview: { state: string; progress: number } | null;
  hasThumbs: boolean;
  thumbs: { state: string; progress: number } | null;
}

export type CropAspect = "free" | "16:9" | "9:16" | "1:1" | "4:5";

export const CROP_ASPECTS: { id: CropAspect; label: string; ratio: number | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
];
