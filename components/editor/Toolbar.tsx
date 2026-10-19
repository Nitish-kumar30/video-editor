"use client";
/** Left tool rail. Tools: Select, Blur, Pixelate, Box, Text, Image/Logo, Crop. */
import { MousePointer2, Droplets, Grid3x3, Square, Type, ImagePlus, Crop } from "lucide-react";
import type { Tool } from "./types";

const TOOLS: { id: Tool; label: string; hint: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "select", label: "Select", hint: "Select, move and resize items (Esc)", icon: MousePointer2 },
  { id: "blur", label: "Blur", hint: "Drag on the video to blur an area (B adds one at the playhead)", icon: Droplets },
  { id: "pixelate", label: "Pixelate", hint: "Drag on the video to pixelate an area", icon: Grid3x3 },
  { id: "box", label: "Box", hint: "Drag on the video to hide an area with a solid box", icon: Square },
  { id: "text", label: "Text", hint: "Click on the video to add text (T)", icon: Type },
  { id: "image", label: "Logo", hint: "Add an image or logo", icon: ImagePlus },
  { id: "crop", label: "Crop", hint: "Crop the frame, e.g. 9:16 for Reels/Shorts", icon: Crop },
];

export default function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-ink-700 bg-ink-900 py-2">
      {TOOLS.map(({ id, label, hint, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={hint}
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
