"use client";
/**
 * Export dialog: pick resolution, quality and file name, render with FFmpeg on the
 * server (same code as `npm run render`), watch progress, download the MP4.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, X, Film, Loader2, AlertTriangle } from "lucide-react";
import { EXPORT_HEIGHTS, formatTime, type Edits, type ExportHeight, type Quality } from "@/lib/schema";
import { keepSegments, outputDuration } from "@/lib/timeline";
import { rectPx } from "@/lib/render";

interface Job {
  state: "running" | "done" | "error" | "canceled";
  progress: number;
  output?: string;
  error?: string;
  log: string[];
}
interface ExportFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

export default function ExportDialog({
  projectId,
  edits,
  onClose,
  onSettings,
  beforeRender,
}: {
  projectId: string;
  edits: Edits;
  onClose: () => void;
  onSettings: (p: Partial<Edits["export"]>) => void;
  beforeRender: () => Promise<void>;
}) {
  const [height, setHeight] = useState<ExportHeight>(edits.export.height);
  const [quality, setQuality] = useState<Quality>(edits.export.quality);
  const [filename, setFilename] = useState(edits.export.filename ?? edits.name ?? "");
  const [job, setJob] = useState<Job | null>(null);
  const [exportsList, setExports] = useState<ExportFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/render`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    setJob(data.job);
    setExports(data.exports);
    return data.job as Job | null;
  }, [projectId]);

  useEffect(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    if (job?.state !== "running") return;
    const t = setInterval(poll, 500);
    return () => clearInterval(t);
  }, [job?.state, poll]);

  const segs = keepSegments(edits.cuts, edits.source.duration);
  const outDur = outputDuration(segs);
  const base = edits.crop ? rectPx(edits.crop, edits.source.width, edits.source.height) : { w: edits.source.width, h: edits.source.height };
  const outH = height ?? base.h;
  const outW = Math.round((base.w * outH) / base.h / 2) * 2;

  async function start() {
    setError(null);
    onSettings({ height, quality, filename: filename || undefined });
    await beforeRender();
    const res = await fetch(`/api/projects/${projectId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ height, quality, filename }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Could not start the export");
    setJob(data.job);
  }

  async function cancel() {
    await fetch(`/api/projects/${projectId}/render`, { method: "DELETE" });
    poll();
  }

  const running = job?.state === "running";
  const fileUrl = (p: string, download = false) => `/api/projects/${projectId}/file/${p.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="w-full max-w-lg rounded-xl border border-ink-600 bg-ink-850 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Film size={18} /> Export MP4
          </h2>
          <button className="rounded p-1 text-ink-300 hover:bg-ink-700" onClick={onClose} data-tip="Close this window. A running export keeps going in the background.">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 p-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1" data-tip-title="Resolution" data-tip="Height of the exported video in pixels. Original keeps the full size. 1080p is plenty for social media; 720p/480p make smaller files.">
              <span className="text-xs text-ink-300">Resolution</span>
              <select className="field" value={String(height)} disabled={running} onChange={(e) => setHeight(e.target.value === "null" ? null : (Number(e.target.value) as ExportHeight))}>
                {EXPORT_HEIGHTS.map((h) => (
                  <option key={String(h)} value={String(h)}>
                    {h ? `${h}p` : "Original"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1" data-tip-title="Quality" data-tip="High looks best but makes a big file. Medium is a good balance. Small is easy to send by chat or email.">
              <span className="text-xs text-ink-300">Quality</span>
              <select className="field" value={quality} disabled={running} onChange={(e) => setQuality(e.target.value as Quality)}>
                <option value="high">High (big file)</option>
                <option value="medium">Medium</option>
                <option value="small">Small file</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1" data-tip-title="File name" data-tip="Name of the MP4. It is saved in this project's exports folder; an existing file is never overwritten (a number is added).">
            <span className="text-xs text-ink-300">File name</span>
            <div className="flex items-center gap-1">
              <input className="field" value={filename} disabled={running} placeholder="my-video" onChange={(e) => setFilename(e.target.value)} />
              <span className="text-ink-400">.mp4</span>
            </div>
          </label>
          <p className="text-xs text-ink-400">
            Output: {outW}×{outH}, {formatTime(outDur)} long{segs.length > 1 ? `, ${segs.length} parts joined` : ""}.
          </p>

          {job && (
            <div className="rounded-lg bg-ink-900 p-3" data-tip="Progress of the export. If it fails, the last messages from FFmpeg are shown here.">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  {running && <Loader2 size={12} className="animate-spin" />}
                  {running ? "Rendering…" : job.state === "done" ? "Done!" : job.state === "canceled" ? "Canceled" : "Failed"}
                </span>
                <span className="font-mono">{Math.round(job.progress)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-ink-700">
                <div className={`h-full transition-all ${job.state === "error" ? "bg-red-500" : "bg-accent"}`} style={{ width: `${job.progress}%` }} />
              </div>
              {job.state === "error" && (
                <div className="mt-2 text-xs text-red-300">
                  <div className="flex items-center gap-1">
                    <AlertTriangle size={12} /> {job.error}
                  </div>
                  {job.log.length > 0 && <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 p-2 text-[10px] whitespace-pre-wrap text-ink-300">{job.log.slice(-8).join("\n")}</pre>}
                </div>
              )}
              {job.state === "done" && job.output && (
                <a href={fileUrl(job.output, true)} className="mt-3 flex items-center justify-center gap-2 rounded-md bg-green-600 py-2 font-medium text-white hover:bg-green-500">
                  <Download size={16} /> Download {job.output.replace(/^exports\//, "")}
                </a>
              )}
            </div>
          )}
          {error && <div className="text-xs text-red-300">{error}</div>}

          <div className="flex justify-end gap-2">
            {running ? (
              <button className="rounded-md border border-ink-600 px-3 py-2 hover:bg-ink-700" onClick={cancel} data-tip="Stop this export. Nothing is saved.">
                Cancel export
              </button>
            ) : (
              <button
                className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong"
                onClick={start}
                data-tip="Save your latest changes and start making the MP4 from the original, full-quality video. Same result as `npm run render`."
              >
                {job?.state === "done" ? "Export again" : "Start export"}
              </button>
            )}
          </div>

          {exportsList.length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-ink-300 uppercase">Previous exports</h3>
              <ul className="max-h-40 divide-y divide-ink-700 overflow-auto rounded border border-ink-700">
                {exportsList.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <a href={fileUrl(f.path)} target="_blank" rel="noreferrer" className="truncate hover:underline" data-tip="Watch this export in a new browser tab.">
                      {f.name}
                    </a>
                    <span className="shrink-0 text-ink-400">
                      {fmtSize(f.size)} · {new Date(f.mtime).toLocaleString()}
                    </span>
                    <a href={fileUrl(f.path, true)} className="shrink-0 rounded p-1 hover:bg-ink-700" data-tip="Download this MP4 to your Downloads folder.">
                      <Download size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
