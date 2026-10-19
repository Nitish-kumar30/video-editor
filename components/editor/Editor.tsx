"use client";
/**
 * The editor page: top bar, tool rail, stage (video + overlays), transport,
 * inspector and timeline. State lives in useProject (edits + undo/redo + autosave +
 * live sync with edits.json); this component wires playback and keyboard shortcuts.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Download,
  Play,
  Pause,
  StepBack,
  StepForward,
  Scissors,
  CheckCircle2,
  RefreshCw,
  CircleAlert,
  Loader2,
  Keyboard,
  ZoomIn,
} from "lucide-react";
import { clamp, formatTime, newId, round3, type ImageItem, type Region, type TextItem } from "@/lib/schema";
import { keepSegments, outputDuration, skipCut, sourceToOutput } from "@/lib/timeline";
import { useProject } from "./useProject";
import Stage from "./Stage";
import Timeline from "./Timeline";
import Inspector from "./Inspector";
import Toolbar from "./Toolbar";
import ExportDialog from "./ExportDialog";
import { fitAspect } from "./geometry";
import { CROP_ASPECTS, type CropAspect, type Selection, type Tool } from "./types";

export default function Editor({ id }: { id: string }) {
  const project = useProject(id);
  const { edits, media, update, undo, redo } = project;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [cropAspect, setCropAspect] = useState<CropAspect>("free");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inMark, setInMark] = useState<number | null>(null);
  const [outMark, setOutMark] = useState<number | null>(null);
  const [skipCuts, setSkipCuts] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [showExport, setShowExport] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const duration = edits?.source.duration ?? 0;
  const fps = edits?.source.fps ?? 30;

  const flash = useCallback((msg: string) => {
    setHint(msg);
    setTimeout(() => setHint((h) => (h === msg ? null : h)), 2500);
  }, []);

  // ---- playback ---------------------------------------------------------------
  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const nt = clamp(t, 0, duration);
      if (v) v.currentTime = nt;
      setCurrentTime(nt);
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= duration - 0.05) v.currentTime = 0;
      void v.play();
    } else v.pause();
  }, [duration]);

  const step = useCallback(
    (frames: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      seek(round3(v.currentTime + frames / fps));
    },
    [fps, seek],
  );

  // Smooth playhead while playing, and jump over cuts when "Skip cuts" is on.
  const cutsRef = useRef(edits?.cuts ?? []);
  cutsRef.current = edits?.cuts ?? [];
  const skipRef = useRef(skipCuts);
  skipRef.current = skipCuts;
  const videoSrc = media && edits ? `/api/projects/${id}/file/${encodeURIComponent(media.videoFile)}` : "";
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (skipRef.current && !v.paused) {
        const jump = skipCut(v.currentTime, cutsRef.current, duration);
        if (jump !== null) {
          if (jump >= duration - 0.05) v.pause();
          v.currentTime = jump;
        }
      }
      setCurrentTime(v.currentTime);
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setCurrentTime(v.currentTime);
    };
    const onSeeked = () => setCurrentTime(v.currentTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ended", onPause);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("ended", onPause);
    };
  }, [duration, videoSrc]);

  // When the preview proxy becomes ready the src changes: keep the playhead where it was.
  const lastTime = useRef(0);
  lastTime.current = currentTime;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    const t = lastTime.current;
    const restore = () => {
      if (t > 0) v.currentTime = t;
    };
    v.addEventListener("loadedmetadata", restore, { once: true });
    return () => v.removeEventListener("loadedmetadata", restore);
  }, [videoSrc]);

  // ---- creating items -----------------------------------------------------------
  const newItemRange = useCallback((): [number, number] => {
    if (inMark !== null && outMark !== null && outMark - inMark >= 0.05) return [round3(inMark), round3(outMark)];
    const s = round3(currentTime);
    return [s, round3(Math.min(duration, s + 5))];
  }, [inMark, outMark, currentTime, duration]);

  const uploadAsset = useCallback(
    async (file: File) => {
      const res = await fetch(`/api/projects/${id}/upload?kind=asset&name=${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
      const data = await res.json();
      if (!res.ok) {
        flash(data.error || "Upload failed");
        throw new Error(data.error);
      }
      return data.file as string;
    },
    [id, flash],
  );

  async function addImage(file: File) {
    const path = await uploadAsset(file);
    const [start, end] = inMark !== null && outMark !== null && outMark > inMark ? newItemRange() : [0, duration];
    const img: ImageItem = { id: newId("image"), file: path, x: 0.82, y: 0.8, w: 0.15, opacity: 1, start, end };
    update((d) => ({ ...d, images: [...d.images, img] }));
    setSelection({ kind: "image", id: img.id });
  }

  const addBlurAtPlayhead = useCallback(() => {
    const [start, end] = newItemRange();
    const r: Region = { id: newId("blur"), type: "blur", x: 0.375, y: 0.375, w: 0.25, h: 0.25, start, end, strength: 50, color: "#000000" };
    update((d) => ({ ...d, regions: [...d.regions, r] }));
    setSelection({ kind: "region", id: r.id });
    setTool("select");
  }, [newItemRange, update]);

  const addTextAtPlayhead = useCallback(() => {
    const [start, end] = newItemRange();
    const t: TextItem = { id: newId("text"), text: "Your text", x: 0.05, y: 0.82, size: 0.06, color: "#ffffff", background: "#000000", bgOpacity: 0.6, start, end };
    update((d) => ({ ...d, texts: [...d.texts, t] }));
    setSelection({ kind: "text", id: t.id });
    setTool("select");
  }, [newItemRange, update]);

  const cutInOut = useCallback(() => {
    if (inMark === null || outMark === null || outMark - inMark < 0.05) {
      flash("Set In (I) and Out (O) marks first, then press C to cut that part out.");
      return;
    }
    const c = { id: newId("cut"), start: round3(inMark), end: round3(outMark) };
    update((d) => ({ ...d, cuts: [...d.cuts, c] }));
    setSelection({ kind: "cut", id: c.id });
    setInMark(null);
    setOutMark(null);
    flash(`Cut ${formatTime(c.start)} – ${formatTime(c.end)}`);
  }, [inMark, outMark, update, flash]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    update((d) => {
      switch (selection.kind) {
        case "region":
          return { ...d, regions: d.regions.filter((x) => x.id !== selection.id) };
        case "text":
          return { ...d, texts: d.texts.filter((x) => x.id !== selection.id) };
        case "image":
          return { ...d, images: d.images.filter((x) => x.id !== selection.id) };
        case "cut":
          return { ...d, cuts: d.cuts.filter((x) => x.id !== selection.id) };
        case "crop":
          return { ...d, crop: null };
      }
    });
    setSelection(null);
  }, [selection, update]);

  const chooseTool = useCallback(
    (t: Tool) => {
      if (t === "image") {
        imageInput.current?.click();
        return;
      }
      if (t === "crop") {
        if (edits && !edits.crop) {
          const ratio = CROP_ASPECTS.find((a) => a.id === cropAspect)?.ratio;
          update((d) => ({ ...d, crop: ratio ? fitAspect(ratio, d.source.width, d.source.height) : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }));
        }
        setSelection({ kind: "crop" });
      } else if (selection?.kind === "crop") setSelection(null);
      setTool(t);
    },
    [edits, cropAspect, update, selection],
  );

  // ---- keyboard shortcuts --------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (typing && e.key === "Escape") {
        el.blur(); // leave the text field; the next Escape deselects
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return; // let the text field undo its own typing
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        if (typing) return;
        e.preventDefault();
        redo();
        return;
      }
      if (typing || mod || e.altKey) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) seek(currentTime - 1);
          else step(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) seek(currentTime + 1);
          else step(1);
          break;
        case "i":
        case "I":
          setInMark(round3(currentTime));
          if (outMark !== null && outMark <= currentTime) setOutMark(null);
          break;
        case "o":
        case "O":
          setOutMark(round3(currentTime));
          if (inMark !== null && inMark >= currentTime) setInMark(null);
          break;
        case "c":
        case "C":
          cutInOut();
          break;
        case "b":
        case "B":
          addBlurAtPlayhead();
          break;
        case "t":
        case "T":
          addTextAtPlayhead();
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          deleteSelection();
          break;
        case "Escape":
          setSelection(null);
          setTool("select");
          setShowKeys(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, togglePlay, seek, step, currentTime, inMark, outMark, cutInOut, addBlurAtPlayhead, addTextAtPlayhead, deleteSelection]);

  // Drop the selection if the item disappeared (undo, external edit).
  useEffect(() => {
    if (!edits || !selection || selection.kind === "crop") return;
    const lists = { region: edits.regions, text: edits.texts, image: edits.images, cut: edits.cuts };
    if (!lists[selection.kind].some((x) => x.id === selection.id)) setSelection(null);
  }, [edits, selection]);

  // ---- render ------------------------------------------------------------------
  if (!edits || !media) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-300">
        {project.error ? (
          <div className="text-center">
            <p className="mb-3 text-red-300">{project.error}</p>
            <Link href="/" className="text-accent hover:underline">
              Back to projects
            </Link>
          </div>
        ) : (
          <Loader2 className="animate-spin" />
        )}
      </div>
    );
  }

  const segs = keepSegments(edits.cuts, duration);
  const outTime = sourceToOutput(currentTime, segs);
  const thumbsUrl = media.hasThumbs ? `/api/projects/${id}/file/thumbs.jpg` : null;
  const statusView = {
    loading: { icon: <Loader2 size={14} className="animate-spin" />, text: "Loading…", cls: "text-ink-300" },
    saving: { icon: <Loader2 size={14} className="animate-spin" />, text: "Saving…", cls: "text-ink-300" },
    unsaved: { icon: <Loader2 size={14} className="animate-spin" />, text: "Saving…", cls: "text-ink-300" },
    saved: { icon: <CheckCircle2 size={14} />, text: "Saved", cls: "text-green-400" },
    synced: { icon: <RefreshCw size={14} />, text: "Synced from edits.json", cls: "text-sky-300" },
    error: { icon: <CircleAlert size={14} />, text: `Not saved: ${project.error ?? ""}`, cls: "text-red-300" },
  }[project.status];

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900 px-3">
        <Link href="/" className="rounded p-1.5 text-ink-300 hover:bg-ink-700 hover:text-white" title="All projects">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <div className="truncate font-semibold">{edits.name || id}</div>
        </div>
        <div className={`flex items-center gap-1 text-xs ${statusView.cls}`} title={`projects/${id}/edits.json`}>
          {statusView.icon}
          {statusView.text}
        </div>
        {project.jsonError && (
          <div className="flex items-center gap-1 rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-200" title={project.jsonError}>
            <CircleAlert size={14} /> edits.json has a typo — fix it and the editor will reload it
          </div>
        )}
        <div className="flex-1" />
        {hint && <div className="rounded bg-ink-700 px-2 py-1 text-xs text-ink-100">{hint}</div>}
        <button className="rounded p-1.5 text-ink-300 hover:bg-ink-700 hover:text-white disabled:opacity-30" onClick={undo} disabled={!project.canUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={18} />
        </button>
        <button className="rounded p-1.5 text-ink-300 hover:bg-ink-700 hover:text-white disabled:opacity-30" onClick={redo} disabled={!project.canRedo} title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={18} />
        </button>
        <div className="relative">
          <button className="rounded p-1.5 text-ink-300 hover:bg-ink-700 hover:text-white" onClick={() => setShowKeys((s) => !s)} title="Keyboard shortcuts">
            <Keyboard size={18} />
          </button>
          {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
        </div>
        <button className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong" onClick={() => setShowExport(true)}>
          <Download size={16} /> Export
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Toolbar tool={tool} onTool={chooseTool} />
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void addImage(f);
          }}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Stage
              projectId={id}
              edits={edits}
              update={update}
              videoRef={videoRef}
              videoSrc={videoSrc}
              currentTime={currentTime}
              tool={tool}
              setTool={setTool}
              selection={selection}
              setSelection={setSelection}
              cropAspect={cropAspect}
              newItemRange={newItemRange}
            />
            {media.preview?.state === "running" && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded bg-black/75 px-3 py-1.5 text-xs text-ink-100">
                <Loader2 size={12} className="mr-1 inline animate-spin" />
                This video&apos;s format needs a browser preview — making one ({Math.round(media.preview.progress)}%). Exports always use the original.
              </div>
            )}
            {tool !== "select" && tool !== "crop" && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/75 px-3 py-1 text-xs text-ink-100">
                {tool === "text" ? "Click on the video to place text" : `Drag on the video to draw a ${tool} area`} · Esc to cancel
              </div>
            )}
          </div>

          {/* Transport */}
          <div className="flex h-11 shrink-0 items-center gap-2 border-t border-ink-700 bg-ink-900 px-3 text-sm">
            <button className="rounded p-1.5 hover:bg-ink-700" onClick={() => step(-1)} title="Previous frame (←)">
              <StepBack size={16} />
            </button>
            <button className="rounded-full bg-ink-700 p-2 hover:bg-ink-600" onClick={togglePlay} title="Play / pause (Space)">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="rounded p-1.5 hover:bg-ink-700" onClick={() => step(1)} title="Next frame (→)">
              <StepForward size={16} />
            </button>
            <div className="font-mono text-xs">
              <span className="text-white">{formatTime(currentTime)}</span>
              <span className="text-ink-400"> / {formatTime(duration)}</span>
            </div>
            <div className="hidden font-mono text-[11px] text-ink-400 lg:block" title="Position in the exported video">
              out {outTime === null ? "— (cut)" : formatTime(outTime)} / {formatTime(outputDuration(segs))}
            </div>
            <div className="mx-2 h-5 w-px bg-ink-700" />
            <button className="rounded px-2 py-1 text-xs hover:bg-ink-700" onClick={() => setInMark(round3(currentTime))} title="Set In mark (I)">
              In {inMark !== null && <span className="text-yellow-300">{formatTime(inMark, 1)}</span>}
            </button>
            <button className="rounded px-2 py-1 text-xs hover:bg-ink-700" onClick={() => setOutMark(round3(currentTime))} title="Set Out mark (O)">
              Out {outMark !== null && <span className="text-yellow-300">{formatTime(outMark, 1)}</span>}
            </button>
            <button className="flex items-center gap-1 rounded bg-red-900/60 px-2 py-1 text-xs text-red-100 hover:bg-red-800" onClick={cutInOut} title="Cut out the part between In and Out (C)">
              <Scissors size={14} /> Cut In→Out
            </button>
            {(inMark !== null || outMark !== null) && (
              <button
                className="rounded px-1 text-xs text-ink-400 hover:text-white"
                onClick={() => {
                  setInMark(null);
                  setOutMark(null);
                }}
              >
                clear
              </button>
            )}
            <label className="ml-2 flex items-center gap-1 text-xs text-ink-300" title="Jump over cut parts while playing">
              <input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} /> Skip cuts while previewing
            </label>
            <div className="flex-1" />
            <ZoomIn size={14} className="text-ink-400" />
            <input type="range" min={1} max={60} step={0.5} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-28" title="Timeline zoom (Ctrl + wheel)" />
          </div>
        </main>

        <aside className="w-80 shrink-0 border-l border-ink-700 bg-ink-900">
          <Inspector
            edits={edits}
            update={update}
            selection={selection}
            setSelection={setSelection}
            currentTime={currentTime}
            cropAspect={cropAspect}
            setCropAspect={setCropAspect}
            uploadAsset={uploadAsset}
          />
        </aside>
      </div>

      <div className="h-56 shrink-0 border-t border-ink-700">
        <Timeline
          edits={edits}
          update={update}
          currentTime={currentTime}
          seek={seek}
          selection={selection}
          setSelection={(s) => {
            setSelection(s);
            if (tool !== "select") setTool("select");
          }}
          inMark={inMark}
          outMark={outMark}
          thumbsUrl={thumbsUrl}
          zoom={zoom}
          setZoom={setZoom}
          playing={playing}
        />
      </div>

      {showExport && (
        <ExportDialog
          projectId={id}
          edits={edits}
          onClose={() => setShowExport(false)}
          onSettings={(p) => update((d) => ({ ...d, export: { ...d.export, ...p } }))}
          beforeRender={project.flush}
        />
      )}
    </div>
  );
}

const KEYS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "One frame back / forward"],
  ["Shift + ← / →", "One second back / forward"],
  ["I / O", "Set In / Out mark"],
  ["C", "Cut out In → Out"],
  ["B", "New blur at the playhead"],
  ["T", "New text at the playhead"],
  ["Delete", "Remove the selected item"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Shift+Z", "Redo"],
  ["Esc", "Deselect / back to Select tool"],
  ["Ctrl + wheel", "Zoom the timeline"],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute top-9 right-0 z-50 w-72 rounded-lg border border-ink-600 bg-ink-850 p-3 shadow-xl" onMouseLeave={onClose}>
      <h3 className="mb-2 text-xs font-semibold tracking-wider text-ink-300 uppercase">Keyboard shortcuts</h3>
      <table className="w-full text-xs">
        <tbody>
          {KEYS.map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 pr-2 font-mono whitespace-nowrap text-ink-100">{k}</td>
              <td className="py-0.5 text-ink-300">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
