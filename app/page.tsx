"use client";
/**
 * Home: your projects + a drag-and-drop area to start a new one.
 * Uploading streams the file to projects/<id>/source.<ext> (see app/api/projects/[id]/upload).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Film, Trash2, UploadCloud, Loader2, Terminal } from "lucide-react";
import { formatTime } from "@/lib/schema";

interface ProjectSummary {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  mtime: number;
  hasThumbs: boolean;
  ready: boolean;
}

function timeAgo(ms: number) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [upload, setUpload] = useState<{ name: string; pct: number; phase: "uploading" | "processing" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const data = await res.json();
    setProjects(data.projects ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function start(file: File) {
    setError(null);
    const name = file.name.replace(/\.[^.]+$/, "");
    setUpload({ name: file.name, pct: 0, phase: "uploading" });
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const { id, error: err } = await res.json();
      if (!res.ok) throw new Error(err || "Could not create the project");
      // XHR (not fetch) so we can show upload progress for big files.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/projects/${id}/upload?kind=source&name=${encodeURIComponent(file.name)}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUpload({ name: file.name, pct: (e.loaded / e.total) * 100, phase: "uploading" });
        };
        xhr.upload.onload = () => setUpload({ name: file.name, pct: 100, phase: "processing" });
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let msg = "Upload failed";
            try {
              msg = JSON.parse(xhr.responseText).error || msg;
            } catch {}
            fetch(`/api/projects/${id}`, { method: "DELETE" });
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed — is the server still running?"));
        xhr.send(file);
      });
      router.push(`/editor/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setUpload(null);
      load();
    }
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(`Delete "${p.name}"?\n\nThis removes the project folder, including the copied video, edits and exports. Your original video file is not touched.`)) return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-700 bg-ink-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <Clapperboard className="text-accent" />
          <h1 className="text-lg font-semibold">ClipForge</h1>
          <span className="text-sm text-ink-400">local video editor · nothing leaves your computer</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div
          className={`mb-10 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
            drag ? "border-accent bg-accent/10" : "border-ink-600 bg-ink-900 hover:border-ink-500"
          }`}
          onClick={() => !upload && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f && !upload) start(f);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mov,.mkv,.avi,.mts,.m2ts"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) start(f);
            }}
          />
          {upload ? (
            <div className="w-full max-w-md">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="truncate">{upload.name}</span>
                <span className="font-mono">{upload.phase === "uploading" ? `${Math.round(upload.pct)}%` : ""}</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-ink-700">
                <div className="h-full bg-accent transition-all" style={{ width: `${upload.pct}%` }} />
              </div>
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-ink-300">
                <Loader2 size={14} className="animate-spin" />
                {upload.phase === "uploading" ? "Copying the video into your project…" : "Reading the video…"}
              </p>
            </div>
          ) : (
            <>
              <UploadCloud size={40} className="mb-3 text-ink-400" />
              <p className="font-medium">Drop a video here to start a new project</p>
              <p className="mt-1 text-sm text-ink-400">or click to choose a file · MP4, MOV, MKV, phone videos (HEVC) — any size</p>
            </>
          )}
        </div>
        {error && <p className="-mt-6 mb-6 text-center text-sm text-red-300">{error}</p>}

        <h2 className="mb-4 text-sm font-semibold tracking-wider text-ink-300 uppercase">Projects</h2>
        {projects === null ? (
          <Loader2 className="animate-spin text-ink-400" />
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 text-sm text-ink-300">
            No projects yet. Drop a video above, or from a terminal run:
            <pre className="mt-2 flex items-center gap-2 rounded bg-black/40 p-2 font-mono text-xs text-ink-100">
              <Terminal size={14} /> npm run new -- &quot;C:\path\to\video.mp4&quot;
            </pre>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((p) => (
              <div key={p.id} className="group relative overflow-hidden rounded-lg border border-ink-700 bg-ink-900 transition hover:border-ink-500">
                <Link href={p.ready ? `/editor/${p.id}` : "#"} className="block">
                  <div
                    className="flex aspect-video items-center justify-center bg-ink-800"
                    style={
                      p.hasThumbs
                        ? { backgroundImage: `url(/api/projects/${p.id}/file/thumbs.jpg)`, backgroundSize: "3000% 100%", backgroundPosition: `${(2 / 29) * 100}% 0` }
                        : undefined
                    }
                  >
                    {!p.hasThumbs && <Film className="text-ink-500" />}
                  </div>
                  <div className="p-3">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="mt-1 text-xs text-ink-400">
                      {p.ready ? `${formatTime(p.duration, 0)} · ${p.width}×${p.height} · ${timeAgo(p.mtime)}` : "Upload not finished"}
                    </div>
                  </div>
                </Link>
                <button
                  className="absolute top-2 right-2 rounded bg-black/60 p-1.5 text-ink-200 opacity-0 transition group-hover:opacity-100 hover:bg-red-700 hover:text-white"
                  title="Delete project"
                  onClick={() => remove(p)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
