"use client";
/** Left tool rail. Tools: Select, Blur, Pixelate, Box, Text, Image/Logo, Crop. */
import { MousePointer2, Droplets, Grid3x3, Square, Type, ImagePlus, Crop } from "lucide-react";
import type { Tool } from "./types";

/** `hint` is shown as hover help (see components/HoverTips.tsx). */
const TOOLS: { id: Tool; label: string; title: string; hint: string; icon: React.ComponentType<{ size?: number }> }[] = [
  {
    id: "select",
    label: "Select",
    title: "Select tool (Esc)",
    hint: "Click an item on the video or timeline to select it, drag it to move it, and drag the white squares to resize it. Its settings appear on the right.",
    icon: MousePointer2,
  },
  {
    id: "blur",
    label: "Blur",
    title: "Blur tool (B)",
    hint: "Drag a rectangle on the video to blur that area — for faces, number plates, phone numbers. It lasts 5 s from the playhead (or In→Out); change that on the timeline. B adds one at the playhead.",
    icon: Droplets,
  },
  {
    id: "pixelate",
    label: "Pixelate",
    title: "Pixelate tool",
    hint: "Drag a rectangle on the video to turn that area into big blocks (mosaic). Like blur, but blocky.",
    icon: Grid3x3,
  },
  {
    id: "box",
    label: "Box",
    title: "Box tool",
    hint: "Drag a rectangle on the video to cover that area completely with a solid color. Safest way to hide something.",
    icon: Square,
  },
  {
    id: "text",
    label: "Text",
    title: "Text tool (T)",
    hint: "Click on the video where the text should go, then type it in the panel on the right.",
    icon: Type,
  },
  {
    id: "image",
    label: "Logo",
    title: "Logo / image",
    hint: "Choose a PNG or JPG (transparent PNGs look best). It is placed bottom-right for the whole video; move it, resize it, or set its opacity on the right.",
    icon: ImagePlus,
  },
  {
    id: "crop",
    label: "Crop",
    title: "Crop tool",
    hint: "Cut away the edges of the picture. Pick 9:16 on the right for Reels / Shorts / TikTok, then drag the frame to keep the important part.",
    icon: Crop,
  },
];

export default function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-ink-700 bg-ink-900 py-2">
      {TOOLS.map(({ id, label, title, hint, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={title}
          data-tip-title={title}
          data-tip={hint}
          onClick={() => onTool(id)}
          className={`flex w-14 flex-col items-center gap-0.5 rounded-md py-2 text-[10px] transition ${
            tool === id ? "bg-accent text-white" : "text-ink-300 hover:bg-ink-700 hover:text-white"
          }`}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}
    </nav>
  );
}
