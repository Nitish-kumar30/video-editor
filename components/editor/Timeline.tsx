"use client";
/**
 * Bottom timeline: ruler, thumbnail strip with cut ranges (hatched red), In/Out marks,
 * and one lane per overlay item. Click or drag on the ruler/strip to seek. Drag a bar to
 * move it, drag its edges to change start/end (edges snap to the playhead and In/Out).
 * Ctrl + mouse wheel zooms; the timeline scrolls horizontally when zoomed in.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clamp, formatTime, round3, type Edits } from "@/lib/schema";
import type { Selection, UpdateEdits } from "./types";

interface TimelineProps {
  edits: Edits;
  update: UpdateEdits;
  currentTime: number;
  seek: (t: number) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  inMark: number | null;
  outMark: number | null;
  thumbsUrl: string | null;
  zoom: number;
  setZoom: (z: number) => void;
  playing: boolean;
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

const LANE_COLORS: Record<string, string> = {
  blur: "bg-sky-600/80 border-sky-300",
  pixelate: "bg-violet-600/80 border-violet-300",
  box: "bg-slate-500/80 border-slate-200",
  text: "bg-amber-600/80 border-amber-200",
  image: "bg-emerald-600/80 border-emerald-200",
};

type LaneItem = { kind: "region" | "text" | "image"; id: string; start: number; end: number; label: string; color: string };

export default function Timeline(props: TimelineProps) {
  const { edits, update, currentTime, seek, selection, setSelection, inMark, outMark, thumbsUrl, zoom, setZoom, playing } = props;
  const duration = Math.max(edits.source.duration, 0.1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = ((viewW - 24) / duration) * zoom; // pixels per second
  const innerW = duration * pps + 24;
  const X = (t: number) => 12 + t * pps;

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = X(currentTime);
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 30) el.scrollLeft = x - 40;
  });

  // Ctrl/Cmd + wheel = zoom around the mouse.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseT = (e.clientX - rect.left + el.scrollLeft - 12) / pps;
      const nz = clamp(zoom * (e.deltaY < 0 ? 1.25 : 0.8), 1, 200);
      setZoom(nz);
      requestAnimationFrame(() => {
        const npps = ((viewW - 24) / duration) * nz;
        el.scrollLeft = 12 + mouseT * npps - (e.clientX - rect.left);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pps, zoom, setZoom, viewW, duration]);

  const timeAt = (clientX: number) => {
    const rect = innerRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left - 12) / pps, 0, duration);
  };

  function startScrub(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const snapPoints = [currentTime, inMark, outMark, 0, duration].filter((v): v is number => v !== null);
  const snap = (t: number) => {
    for (const s of snapPoints) if (Math.abs(s - t) * pps < 6) return s;
    return t;
  };

  /** Drag a bar (mode = move | start | end) and write the new range with `apply`. */
  function startBarDrag(e: React.PointerEvent, s0: number, e0: number, mode: "move" | "start" | "end", apply: (s: number, en: number, key: string) => void) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const key = `bar:${mode}:${Date.now()}`;
    const len = e0 - s0;
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      let s = s0;
      let en = e0;
      if (mode === "move") {
        s = clamp(s0 + dt, 0, duration - len);
        const snapped = snap(s);
        if (snapped !== s) s = snapped;
        else if (snap(s + len) !== s + len) s = snap(s + len) - len;
        s = clamp(s, 0, duration - len);
        en = s + len;
      } else if (mode === "start") s = clamp(snap(s0 + dt), 0, e0 - 0.05);
      else en = clamp(snap(e0 + dt), s0 + 0.05, duration);
      apply(round3(s), round3(en), key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Ruler ticks
  const step = TICK_STEPS.find((s) => s * pps >= 70) ?? 1200;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  const decimals = step < 1 ? 1 : 0;

  const lanes: LaneItem[] = [
    ...edits.regions.map((r) => ({ kind: "region" as const, id: r.id, start: r.start, end: r.end, label: r.label || r.type, color: LANE_COLORS[r.type] })),
    ...edits.texts.map((t) => ({ kind: "text" as const, id: t.id, start: t.start, end: t.end, label: `T  ${t.text.split("\n")[0]}`, color: LANE_COLORS.text })),
    ...edits.images.map((i) => ({ kind: "image" as const, id: i.id, start: i.start, end: i.end, label: i.file.replace(/^assets\//, ""), color: LANE_COLORS.image })),
  ];

  const setRange = (kind: LaneItem["kind"] | "cut", id: string) => (s: number, en: number, key: string) =>
    update((d) => {
      const fix = <T extends { id: string; start: number; end: number }>(arr: T[]) => arr.map((x) => (x.id === id ? { ...x, start: s, end: en } : x));
      if (kind === "region") return { ...d, regions: fix(d.regions) };
      if (kind === "text") return { ...d, texts: fix(d.texts) };
      if (kind === "image") return { ...d, images: fix(d.images) };
      return { ...d, cuts: fix(d.cuts) };
    }, key);

  const isSel = (kind: string, id: string) => !!selection && selection.kind === kind && "id" in selection && selection.id === id;

  return (
    <div ref={scrollRef} className="relative h-full overflow-x-auto overflow-y-auto bg-ink-900">
      <div ref={innerRef} className="relative min-h-full" style={{ width: innerW }}>
        {/* Ruler */}
        <div
          className="sticky top-0 z-20 h-6 cursor-pointer border-b border-ink-700 bg-ink-850"
          onPointerDown={startScrub}
          data-tip-title="Time ruler"
          data-tip="Times of the ORIGINAL video. Click or drag here to move the playhead (red line)."
        >
          {ticks.map((t) => (
            <div key={t} className="absolute top-0 h-full border-l border-ink-600" style={{ left: X(t) }}>
              <span className="ml-1 text-[10px] text-ink-300">{formatTime(t, decimals)}</span>
            </div>
          ))}
        </div>

        {/* Video track: thumbnails + cuts + in/out */}
        <div
          className="relative h-14 cursor-pointer border-b border-ink-700 bg-ink-800"
          onPointerDown={startScrub}
          data-tip-title="Video track"
          data-tip={"Thumbnails of your video. Click or drag to move the playhead.\nRed-striped parts are cut out of the export. Yellow shading is the range between your In and Out marks."}
        >
          {thumbsUrl && (
            <div
              className="absolute top-1 bottom-1 rounded-sm opacity-90"
              style={{ left: X(0), width: duration * pps, backgroundImage: `url(${thumbsUrl})`, backgroundSize: "100% 100%" }}
            />
          )}
          {inMark !== null && outMark !== null && outMark > inMark && (
            <div className="pointer-events-none absolute top-0 bottom-0 border-x border-yellow-300/80 bg-yellow-300/15" style={{ left: X(inMark), width: (outMark - inMark) * pps }} />
          )}
          {edits.cuts.map((c) => {
            const sel = isSel("cut", c.id);
            return (
              <div
                key={c.id}
                data-tip-title={`Cut ${formatTime(c.start)} – ${formatTime(c.end)} (removed)`}
                data-tip="This part is removed from the export. Drag to move it, drag its edges to change it; press Delete (or use the panel on the right) to keep this part after all."
                className={`cut-hatch absolute top-0 bottom-0 cursor-grab border-x-2 ${sel ? "border-white" : "border-red-400"}`}
                style={{ left: X(c.start), width: Math.max(3, (c.end - c.start) * pps) }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setSelection({ kind: "cut", id: c.id });
                  startBarDrag(e, c.start, c.end, "move", setRange("cut", c.id));
                }}
              >
                <span className="pointer-events-none absolute top-0.5 left-1 rounded bg-red-900/80 px-1 text-[9px] font-semibold text-white">CUT</span>
                <Edge side="start" onDown={(e) => startBarDrag(e, c.start, c.end, "start", setRange("cut", c.id))} />
                <Edge side="end" onDown={(e) => startBarDrag(e, c.start, c.end, "end", setRange("cut", c.id))} />
              </div>
            );
          })}
          {inMark !== null && <Mark x={X(inMark)} label="IN" />}
          {outMark !== null && <Mark x={X(outMark)} label="OUT" />}
        </div>

        {/* Item lanes */}
        {lanes.length === 0 && <div className="px-3 py-2 text-xs text-ink-400" data-tip="Each blur, pixelate, box, text and logo gets its own row. The bar shows when it is visible.">Blurs, boxes, texts and logos you add show up here as bars.</div>}
        {lanes.map((l, i) => {
          const sel = isSel(l.kind, l.id);
          return (
            <div key={l.id} className={`relative h-7 border-b border-ink-800 ${i % 2 ? "bg-ink-900" : "bg-ink-850/60"}`}>
              <div
                className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border text-[11px] leading-5 text-white ${l.color} ${sel ? "ring-2 ring-white" : "border-transparent"}`}
                style={{ left: X(l.start), width: Math.max(4, (l.end - l.start) * pps) }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setSelection({ kind: l.kind, id: l.id } as Selection);
                  startBarDrag(e, l.start, l.end, "move", setRange(l.kind, l.id));
                }}
                data-tip-title={`${l.label} · ${formatTime(l.start)} – ${formatTime(l.end)}`}
                data-tip="When this item is visible (times of the original video). Drag the bar to move it in time; drag its left or right edge to change when it starts or ends. Edges snap to the playhead and In/Out marks."
              >
                <span className="pointer-events-none truncate px-2">{l.label}</span>
                <Edge side="start" onDown={(e) => startBarDrag(e, l.start, l.end, "start", setRange(l.kind, l.id))} />
                <Edge side="end" onDown={(e) => startBarDrag(e, l.start, l.end, "end", setRange(l.kind, l.id))} />
              </div>
            </div>
          );
        })}

        {/* Playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-red-500" style={{ left: X(currentTime) }}>
          <div className="absolute -top-0 -left-[5px] h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-red-500" />
        </div>
      </div>
    </div>
  );
}

function Edge({ side, onDown }: { side: "start" | "end"; onDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      className={`absolute top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 ${side === "start" ? "left-0" : "right-0"}`}
      data-tip={side === "start" ? "Drag to change the start time." : "Drag to change the end time."}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onDown(e);
      }}
    />
  );
}

function Mark({ x, label }: { x: number; label: string }) {
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-yellow-300" style={{ left: x }}>
      <span className="absolute bottom-0 -left-3 rounded bg-yellow-300 px-1 text-[9px] font-bold text-black">{label}</span>
    </div>
  );
}
