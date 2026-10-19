"use client";
/**
 * The video with an overlay layer that previews every edit live:
 *  - blur: CSS backdrop-filter, pixelate: a tiny canvas scaled up without smoothing,
 *    box: a solid color, text and images: the real thing (same font as the export).
 *  - Drag on the video to draw a region; select an item to move/resize it.
 *  - Crop shows a dimmed mask; with the Crop tool you can drag its edges.
 * All positions are normalized 0–1 (see lib/schema.ts), so the preview is size-independent.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { newId, round3, clamp, formatTime, type Edits, type Region, type TextItem, type ImageItem } from "@/lib/schema";
import { blurRadii, pixelBlock, textMetrics, FONT_LINE_HEIGHT } from "@/lib/render";
import type { CropAspect, Selection, Tool, UpdateEdits } from "./types";
import { CROP_ASPECTS } from "./types";
import { ALL_HANDLES, CORNERS, handleStyle, moveRect, rectFromPoints, resizeRect, type Handle, type Rect } from "./geometry";

interface StageProps {
  projectId: string;
  edits: Edits;
  update: UpdateEdits;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  currentTime: number;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  cropAspect: CropAspect;
  /** [start, end] for a newly created item. */
  newItemRange: () => [number, number];
}

const hexToRgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export default function Stage(props: StageProps) {
  const { edits, update, videoRef, videoSrc, currentTime, tool, setTool, selection, setSelection, cropAspect, newItemRange, projectId } = props;
  const W = edits.source.width;
  const H = edits.source.height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [drawing, setDrawing] = useState<Rect | null>(null);

  // Fit the video box inside the available space, keeping the source aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth - 24;
      const ch = el.clientHeight - 24;
      const a = W / H;
      const w = Math.max(50, Math.min(cw, ch * a));
      setBox({ w, h: w / a });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const scale = box.h / H; // display px per source px
  const cropRatio = CROP_ASPECTS.find((a) => a.id === cropAspect)?.ratio ?? null;

  /** Generic pointer drag; reports movement in normalized units. */
  function drag(e: React.PointerEvent, onMove: (dx: number, dy: number, p: { x: number; y: number }) => void, onEnd?: () => void) {
    e.preventDefault();
    e.stopPropagation();
    const rect = overlayRef.current!.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) =>
      onMove((ev.clientX - sx) / rect.width, (ev.clientY - sy) / rect.height, {
        x: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((ev.clientY - rect.top) / rect.height, 0, 1),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function pointFromEvent(e: React.PointerEvent) {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1) };
  }

  // ---- background pointer: draw regions, place text, deselect ------------------
  function onOverlayDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = pointFromEvent(e);
    if (tool === "blur" || tool === "pixelate" || tool === "box") {
      const type = tool;
      let r: Rect = { x: p.x, y: p.y, w: 0, h: 0 };
      setDrawing(r);
      drag(
        e,
        (_dx, _dy, q) => {
          r = rectFromPoints(p.x, p.y, q.x, q.y);
          setDrawing(r);
        },
        () => {
          setDrawing(null);
          if (r.w < 0.01 || r.h < 0.01) r = { x: clamp(p.x - 0.1, 0, 0.8), y: clamp(p.y - 0.1, 0, 0.8), w: 0.2, h: 0.2 };
          const [start, end] = newItemRange();
          const region: Region = {
            id: newId(type),
            type,
            x: round3(r.x),
            y: round3(r.y),
            w: round3(r.w),
            h: round3(r.h),
            start,
            end,
            strength: 50,
            color: "#000000",
          };
          update((d) => ({ ...d, regions: [...d.regions, region] }));
          setSelection({ kind: "region", id: region.id });
          setTool("select");
        },
      );
      return;
    }
    if (tool === "text") {
      e.preventDefault();
      const [start, end] = newItemRange();
      const t: TextItem = {
        id: newId("text"),
        text: "Your text",
        x: round3(p.x),
        y: round3(p.y),
        size: 0.06,
        color: "#ffffff",
        background: "#000000",
        bgOpacity: 0.6,
        start,
        end,
      };
      update((d) => ({ ...d, texts: [...d.texts, t] }));
      setSelection({ kind: "text", id: t.id });
      setTool("select");
      return;
    }
    if (tool === "select") setSelection(null);
  }

  // ---- item interactions --------------------------------------------------------
  const canEdit = tool === "select";

  function startMoveRegion(e: React.PointerEvent, r: Region) {
    setSelection({ kind: "region", id: r.id });
    const key = `move:${r.id}:${Date.now()}`;
    drag(e, (dx, dy) => {
      const nr = moveRect(r, dx, dy);
      update((d) => ({ ...d, regions: d.regions.map((x) => (x.id === r.id ? { ...x, ...nr } : x)) }), key);
    });
  }

  function startResizeRegion(e: React.PointerEvent, r: Region, h: Handle) {
    const key = `resize:${r.id}:${Date.now()}`;
    drag(e, (dx, dy) => {
      const nr = resizeRect(r, h, dx, dy);
      update((d) => ({ ...d, regions: d.regions.map((x) => (x.id === r.id ? { ...x, ...nr } : x)) }), key);
    });
  }

  function startMovePoint(e: React.PointerEvent, kind: "text" | "image", item: TextItem | ImageItem) {
    setSelection({ kind, id: item.id });
    const key = `move:${item.id}:${Date.now()}`;
    drag(e, (dx, dy) => {
      const x = round3(clamp(item.x + dx, 0, 0.99));
      const y = round3(clamp(item.y + dy, 0, 0.99));
      update((d) =>
        kind === "text"
          ? { ...d, texts: d.texts.map((t) => (t.id === item.id ? { ...t, x, y } : t)) }
          : { ...d, images: d.images.map((i) => (i.id === item.id ? { ...i, x, y } : i)) },
        key,
      );
    });
  }

  function startScaleText(e: React.PointerEvent, t: TextItem) {
    const key = `size:${t.id}:${Date.now()}`;
    drag(e, (_dx, dy) => {
      const size = round3(clamp(t.size + dy * 0.5, 0.01, 0.5));
      update((d) => ({ ...d, texts: d.texts.map((x) => (x.id === t.id ? { ...x, size } : x)) }), key);
    });
  }

  function startScaleImage(e: React.PointerEvent, img: ImageItem) {
    const key = `size:${img.id}:${Date.now()}`;
    drag(e, (dx) => {
      const w = round3(clamp(img.w + dx, 0.01, 1));
      update((d) => ({ ...d, images: d.images.map((x) => (x.id === img.id ? { ...x, w } : x)) }), key);
    });
  }

  // crop
  const cropActive = tool === "crop" || selection?.kind === "crop";
  function startMoveCrop(e: React.PointerEvent) {
    const c0 = edits.crop;
    if (!c0) return;
    setSelection({ kind: "crop" });
    const key = `crop:${Date.now()}`;
    drag(e, (dx, dy) => update((d) => ({ ...d, crop: moveRect(c0, dx, dy) }), key));
  }
  function startResizeCrop(e: React.PointerEvent, h: Handle) {
    const c0 = edits.crop;
    if (!c0) return;
    const key = `crop:${Date.now()}`;
    const ratio = cropRatio ? (cropRatio * H) / W : null;
    drag(e, (dx, dy) => update((d) => ({ ...d, crop: resizeRect(c0, h, dx, dy, ratio, 0.05) }), key));
  }

  const t = currentTime;
  const isSel = (kind: string, id: string) => !!selection && selection.kind === kind && "id" in selection && selection.id === id;
  const visible = (s: number, e: number, sel: boolean) => (t >= s && t <= e ? 1 : sel ? 0.45 : 0);

  const px = (r: Rect): React.CSSProperties => ({
    position: "absolute",
    left: r.x * box.w,
    top: r.y * box.h,
    width: r.w * box.w,
    height: r.h * box.h,
  });

  // Hover help (components/HoverTips.tsx) for the video area, depending on the tool.
  const STAGE_TIPS: Record<Tool, string> = {
    select:
      "This is a live preview of your edit — the export will look the same.\nClick an item to select it, drag to move it. Click empty space to deselect and see the project settings on the right.",
    blur: "Drag a rectangle over the area to blur. Press Esc to cancel.",
    pixelate: "Drag a rectangle over the area to pixelate. Press Esc to cancel.",
    box: "Drag a rectangle over the area to cover with a solid box. Press Esc to cancel.",
    text: "Click where the text should start. Press Esc to cancel.",
    image: "",
    crop: "Everything outside the bright frame is cut away in the export. Drag the frame to move it and the white squares to resize it. Pick a shape (9:16, 1:1…) on the right.",
  };
  const timeRange = (s: number, e: number) => `${formatTime(s, 1)} – ${formatTime(e, 1)}`;
  const REGION_NAMES = { blur: "Blur", pixelate: "Pixelate", box: "Box" };

  const fileUrl = (f: string) => `/api/projects/${projectId}/file/${f.split("/").map(encodeURIComponent).join("/")}`;
  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-ink-950">
      <div className="relative shadow-2xl" style={{ width: box.w, height: box.h }}>
        <video
          ref={videoRef}
          src={videoSrc}
          className="absolute inset-0 h-full w-full bg-black"
          style={{ objectFit: "fill" }}
          preload="auto"
          playsInline
        />
        <div
          ref={overlayRef}
          className="absolute inset-0 select-none overflow-hidden"
          style={{ cursor, touchAction: "none" }}
          onPointerDown={onOverlayDown}
          data-tip-title="Video preview"
          data-tip={STAGE_TIPS[tool]}
        >
          {/* Regions */}
          {edits.regions.map((r) => {
            const sel = isSel("region", r.id);
            const op = visible(r.start, r.end, sel);
            if (!op) return null;
            let fill: React.ReactNode = null;
            if (r.type === "blur") {
              const { luma } = blurRadii(r.strength, r.w * W, r.h * H, H);
              fill = <div className="absolute inset-0" style={{ backdropFilter: `blur(${Math.max(1, luma * 0.8 * scale)}px)`, WebkitBackdropFilter: `blur(${Math.max(1, luma * 0.8 * scale)}px)` }} />;
            } else if (r.type === "pixelate") {
              fill = <PixelatePreview videoRef={videoRef} region={r} W={W} H={H} />;
            } else {
              fill = <div className="absolute inset-0" style={{ background: r.color }} />;
            }
            return (
              <div
                key={r.id}
                style={{ ...px(r), opacity: op, pointerEvents: canEdit ? "auto" : "none", cursor: canEdit ? "move" : undefined }}
                className={sel ? "outline-2 outline-accent" : "outline-1 outline-dashed outline-white/40"}
                onPointerDown={(e) => canEdit && e.button === 0 && startMoveRegion(e, r)}
                data-tip-title={`${REGION_NAMES[r.type]}${r.label ? ` — ${r.label}` : ""} · ${timeRange(r.start, r.end)}`}
                data-tip={
                  r.type === "box"
                    ? "Covers this area with a solid color during its time range. Drag to move; select it and drag the white squares to resize."
                    : `${r.type === "blur" ? "Blurs" : "Pixelates"} this area during its time range (see its bar on the timeline). Drag to move; select it and drag the white squares to resize. Strength is on the right.`
                }
              >
                {fill}
                {r.label && <span className="absolute -top-5 left-0 rounded bg-black/70 px-1 text-[10px] text-white">{r.label}</span>}
                {sel &&
                  canEdit &&
                  ALL_HANDLES.map((h) => (
                    <div key={h} style={handleStyle(h)} className="rounded-sm border border-accent bg-white" data-tip="Drag to resize." onPointerDown={(e) => startResizeRegion(e, r, h)} />
                  ))}
              </div>
            );
          })}

          {/* Texts */}
          {edits.texts.map((tx) => {
            const sel = isSel("text", tx.id);
            const op = visible(tx.start, tx.end, sel);
            if (!op) return null;
            const { fontSize, pad } = textMetrics(tx, H);
            return (
              <div
                key={tx.id}
                className={sel ? "outline-2 outline-accent" : ""}
                style={{
                  position: "absolute",
                  left: tx.x * box.w,
                  top: tx.y * box.h,
                  transform: tx.background ? `translate(${-pad * scale}px, ${-pad * scale}px)` : undefined,
                  padding: tx.background ? pad * scale : 0,
                  background: tx.background ? hexToRgba(tx.background, tx.bgOpacity) : "transparent",
                  color: tx.color,
                  fontFamily: "var(--font-video)",
                  fontSize: fontSize * scale,
                  lineHeight: FONT_LINE_HEIGHT,
                  whiteSpace: "pre",
                  opacity: op,
                  pointerEvents: canEdit ? "auto" : "none",
                  cursor: canEdit ? "move" : undefined,
                }}
                onPointerDown={(e) => canEdit && e.button === 0 && startMovePoint(e, "text", tx)}
                data-tip-title={`Text · ${timeRange(tx.start, tx.end)}`}
                data-tip="Drag to move. Select it to change the words, size and colors on the right; drag the white corner square to make it bigger or smaller."
              >
                {tx.text || " "}
                {sel && canEdit && <div style={handleStyle("se")} className="rounded-sm border border-accent bg-white" data-tip="Drag down to make the text bigger, up to make it smaller." onPointerDown={(e) => startScaleText(e, tx)} />}
              </div>
            );
          })}

          {/* Images / logos */}
          {edits.images.map((img) => {
            const sel = isSel("image", img.id);
            const op = visible(img.start, img.end, sel);
            if (!op) return null;
            return (
              <div
                key={img.id}
                className={sel ? "outline-2 outline-accent" : ""}
                style={{ position: "absolute", left: img.x * box.w, top: img.y * box.h, width: img.w * box.w, pointerEvents: canEdit ? "auto" : "none", cursor: canEdit ? "move" : undefined }}
                onPointerDown={(e) => canEdit && e.button === 0 && startMovePoint(e, "image", img)}
                data-tip-title={`Logo / image · ${timeRange(img.start, img.end)}`}
                data-tip="Drag to move. Select it to change size, opacity and corner position on the right; drag the white corner square to resize."
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(img.file)} alt="" draggable={false} className="block w-full" style={{ opacity: img.opacity * op }} />
                {sel && canEdit && <div style={handleStyle("se")} className="rounded-sm border border-accent bg-white" data-tip="Drag right to make it bigger, left to make it smaller." onPointerDown={(e) => startScaleImage(e, img)} />}
              </div>
            );
          })}

          {/* Crop mask */}
          {edits.crop && (
            <div
              style={{
                ...px(edits.crop),
                boxShadow: `0 0 0 9999px rgba(0,0,0,${cropActive ? 0.65 : 0.5})`,
                pointerEvents: cropActive ? "auto" : "none",
                cursor: cropActive ? "move" : undefined,
              }}
              className={cropActive ? "outline-2 outline-amber-400" : "outline-1 outline-white/30"}
              onPointerDown={(e) => cropActive && e.button === 0 && startMoveCrop(e)}
              data-tip-title="Crop frame"
              data-tip={STAGE_TIPS.crop}
            >
              {cropActive && (
                <>
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="border border-white/15" />
                    ))}
                  </div>
                  {(cropRatio ? CORNERS : ALL_HANDLES).map((h) => (
                    <div key={h} style={handleStyle(h)} className="rounded-sm border border-amber-500 bg-white" data-tip="Drag to resize the crop." onPointerDown={(e) => startResizeCrop(e, h)} />
                  ))}
                  <span className="pointer-events-none absolute -top-5 left-0 rounded bg-amber-500 px-1 text-[10px] font-medium text-black">
                    Crop {Math.round(edits.crop.w * W)}×{Math.round(edits.crop.h * H)}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Rectangle being drawn */}
          {drawing && <div style={px(drawing)} className="border-2 border-dashed border-accent bg-accent/15" />}
        </div>
      </div>
    </div>
  );
}

/** Live mosaic preview: draws the region from the video into a tiny canvas, shown scaled up without smoothing. */
function PixelatePreview({ videoRef, region, W, H }: { videoRef: React.RefObject<HTMLVideoElement | null>; region: Region; W: number; H: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const block = pixelBlock(region.strength, H);
  const cw = Math.max(1, Math.round((region.w * W) / block));
  const ch = Math.max(1, Math.round((region.h * H) / block));

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.videoWidth) {
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          const vw = v.videoWidth;
          const vh = v.videoHeight;
          try {
            ctx.drawImage(v, region.x * vw, region.y * vh, region.w * vw, region.h * vh, 0, 0, cw, ch);
          } catch {
            /* video not ready */
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, region.x, region.y, region.w, region.h, cw, ch]);

  return <canvas ref={canvasRef} width={cw} height={ch} className="absolute inset-0 h-full w-full" style={{ imageRendering: "pixelated" }} />;
}
