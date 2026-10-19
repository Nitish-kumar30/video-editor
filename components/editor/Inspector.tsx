"use client";
/**
 * Right panel. Shows fields for the selected item, or the project settings
 * (audio, music, fades, export defaults) when nothing is selected.
 * Every change goes through `update`, so it is undoable and autosaved.
 */
import { useEffect, useRef, useState } from "react";
import { Trash2, Copy, Clock, Music, Upload, X } from "lucide-react";
import { clamp, formatTime, newId, parseTime, round3, EXPORT_HEIGHTS, type Edits, type RegionType } from "@/lib/schema";
import { keepSegments, outputDuration } from "@/lib/timeline";
import { rectPx } from "@/lib/render";
import { CROP_ASPECTS, type CropAspect, type Selection, type UpdateEdits } from "./types";
import { fitAspect } from "./geometry";

interface InspectorProps {
  edits: Edits;
  update: UpdateEdits;
  selection: Selection;
  setSelection: (s: Selection) => void;
  currentTime: number;
  cropAspect: CropAspect;
  setCropAspect: (a: CropAspect) => void;
  uploadAsset: (file: File) => Promise<string>;
}

export default function Inspector(props: InspectorProps) {
  const { edits, selection } = props;
  let body: React.ReactNode;
  if (selection?.kind === "region") body = <RegionPanel {...props} id={selection.id} />;
  else if (selection?.kind === "text") body = <TextPanel {...props} id={selection.id} />;
  else if (selection?.kind === "image") body = <ImagePanel {...props} id={selection.id} />;
  else if (selection?.kind === "cut") body = <CutPanel {...props} id={selection.id} />;
  else if (selection?.kind === "crop") body = <CropPanel {...props} />;
  else body = <ProjectPanel {...props} />;
  return <div className="h-full overflow-y-auto p-3 text-sm">{edits && body}</div>;
}

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wider text-ink-300 uppercase">{title}</h3>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-ink-300">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </label>
  );
}

/** Number input that keeps what you type until it is a valid number. */
function NumField({ value, onChange, step = 1, min, max, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <>
      <input
        type="number"
        className="field"
        value={text}
        step={step}
        min={min}
        max={max}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v, min ?? -Infinity, max ?? Infinity));
        }}
      />
      {suffix && <span className="text-xs text-ink-400">{suffix}</span>}
    </>
  );
}

/** Time input: accepts "83.5", "1:23.5" or "0:01:23". */
function TimeField({ value, onChange, now }: { value: number; onChange: (v: number) => void; now: number }) {
  const [text, setText] = useState(formatTime(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatTime(value));
  }, [value]);
  const commit = () => {
    const v = parseTime(text);
    if (v !== undefined) onChange(round3(v));
    else setText(formatTime(value));
  };
  return (
    <>
      <input
        className="field font-mono"
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button type="button" title="Set to playhead" className="rounded p-1 text-ink-300 hover:bg-ink-700 hover:text-white" onClick={() => onChange(round3(now))}>
        <Clock size={14} />
      </button>
    </>
  );
}

function Slider({ value, onChange, min, max, step = 1, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  return (
    <>
      <input type="range" className="min-w-0 flex-1" value={value} min={min} max={max} step={step} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="w-12 text-right font-mono text-xs text-ink-300">{format ? format(value) : value}</span>
    </>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input type="color" className="h-7 w-10 cursor-pointer rounded border border-ink-600 bg-ink-900" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="font-mono text-xs text-ink-300">{value}</span>
    </>
  );
}

function DangerButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950">
      {children}
    </button>
  );
}

function SmallButton({ onClick, children, active }: { onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${active ? "border-accent bg-accent/20 text-white" : "border-ink-600 text-ink-200 hover:bg-ink-700"}`}
    >
      {children}
    </button>
  );
}

const pct = (v: number) => round3(v * 100);

/** Shared position/size/time fields. `kind` picks the edits array. */
function useItem<K extends "regions" | "texts" | "images" | "cuts">(edits: Edits, update: UpdateEdits, key: K, id: string) {
  type Item = Edits[K][number];
  const item = (edits[key] as Item[]).find((x) => x.id === id);
  const set = (patch: Partial<Item>, field: string) =>
    update((d) => ({ ...d, [key]: (d[key] as Item[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) }), `field:${id}:${field}`);
  const remove = () => update((d) => ({ ...d, [key]: (d[key] as Item[]).filter((x) => x.id !== id) }));
  return { item, set, remove };
}

function TimeRows({ start, end, set, now, duration }: { start: number; end: number; set: (p: { start?: number; end?: number }, f: string) => void; now: number; duration: number }) {
  return (
    <>
      <Row label="Start">
        <TimeField value={start} now={now} onChange={(v) => set({ start: clamp(v, 0, end - 0.05) }, "start")} />
      </Row>
      <Row label="End">
        <TimeField value={end} now={now} onChange={(v) => set({ end: clamp(v, start + 0.05, duration) }, "end")} />
      </Row>
      <div className="pl-22 text-xs text-ink-400">Length {formatTime(end - start)}</div>
    </>
  );
}

function RectRows({ r, set }: { r: { x: number; y: number; w: number; h: number }; set: (p: Partial<{ x: number; y: number; w: number; h: number }>, f: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["x", "y", "w", "h"] as const).map((k) => (
        <label key={k} className="flex items-center gap-1">
          <span className="w-4 text-xs text-ink-300 uppercase">{k}</span>
          <NumField
            value={pct(r[k])}
            step={0.5}
            min={k === "w" || k === "h" ? 1 : 0}
            max={100}
            suffix="%"
            onChange={(v) => {
              const n = round3(v / 100);
              if (k === "x") set({ x: clamp(n, 0, 1 - r.w) }, k);
              if (k === "y") set({ y: clamp(n, 0, 1 - r.h) }, k);
              if (k === "w") set({ w: clamp(n, 0.01, 1 - r.x) }, k);
              if (k === "h") set({ h: clamp(n, 0.01, 1 - r.y) }, k);
            }}
          />
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// panels
// ---------------------------------------------------------------------------

function RegionPanel({ edits, update, id, currentTime, setSelection }: InspectorProps & { id: string }) {
  const { item: r, set, remove } = useItem(edits, update, "regions", id);
  if (!r) return null;
  const title = { blur: "Blur", pixelate: "Pixelate", box: "Box" }[r.type];
  return (
    <>
      <Section title={title}>
        <div className="flex gap-1">
          {(["blur", "pixelate", "box"] as RegionType[]).map((t) => (
            <SmallButton key={t} active={r.type === t} onClick={() => set({ type: t }, "type")}>
              {t[0].toUpperCase() + t.slice(1)}
            </SmallButton>
          ))}
        </div>
        <Row label="Label">
          <input className="field" placeholder="e.g. face, number plate" value={r.label ?? ""} onChange={(e) => set({ label: e.target.value || undefined }, "label")} />
        </Row>
        {r.type !== "box" ? (
          <Row label="Strength">
            <Slider value={r.strength} min={1} max={100} onChange={(v) => set({ strength: v }, "strength")} />
          </Row>
        ) : (
          <Row label="Color">
            <ColorField value={r.color} onChange={(v) => set({ color: v }, "color")} />
          </Row>
        )}
      </Section>
      <Section title="Position (% of frame)">
        <RectRows r={r} set={set} />
      </Section>
      <Section title="Time (source)">
        <TimeRows start={r.start} end={r.end} set={set} now={currentTime} duration={edits.source.duration} />
      </Section>
      <div className="flex gap-2">
        <SmallButton
          onClick={() => {
            const copy = { ...r, id: newId(r.type) };
            update((d) => ({ ...d, regions: [...d.regions, copy] }));
            setSelection({ kind: "region", id: copy.id });
          }}
        >
          <Copy size={12} /> Duplicate
        </SmallButton>
        <DangerButton
          onClick={() => {
            remove();
            setSelection(null);
          }}
        >
          <Trash2 size={12} /> Delete
        </DangerButton>
      </div>
    </>
  );
}

function TextPanel({ edits, update, id, currentTime, setSelection }: InspectorProps & { id: string }) {
  const { item: t, set, remove } = useItem(edits, update, "texts", id);
  if (!t) return null;
  return (
    <>
      <Section title="Text">
        <textarea autoFocus className="field min-h-20 font-[family-name:var(--font-video)]" value={t.text} onChange={(e) => set({ text: e.target.value }, "text")} />
        <Row label="Size">
          <Slider value={pct(t.size)} min={1} max={30} step={0.5} format={(v) => `${v}%`} onChange={(v) => set({ size: round3(v / 100) }, "size")} />
        </Row>
        <Row label="Color">
          <ColorField value={t.color} onChange={(v) => set({ color: v }, "color")} />
        </Row>
        <Row label="Background">
          <input type="checkbox" checked={!!t.background} onChange={(e) => set({ background: e.target.checked ? "#000000" : null }, "bg")} />
          {t.background && <ColorField value={t.background} onChange={(v) => set({ background: v }, "bgcolor")} />}
        </Row>
        {t.background && (
          <Row label="Bg opacity">
            <Slider value={Math.round(t.bgOpacity * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => set({ bgOpacity: v / 100 }, "bgop")} />
          </Row>
        )}
      </Section>
      <Section title="Position (% of frame)">
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <span className="w-4 text-xs text-ink-300 uppercase">{k}</span>
              <NumField value={pct(t[k])} step={0.5} min={0} max={99} suffix="%" onChange={(v) => set({ [k]: round3(v / 100) }, k)} />
            </label>
          ))}
        </div>
      </Section>
      <Section title="Time (source)">
        <TimeRows start={t.start} end={t.end} set={set} now={currentTime} duration={edits.source.duration} />
      </Section>
      <DangerButton
        onClick={() => {
          remove();
          setSelection(null);
        }}
      >
        <Trash2 size={12} /> Delete
      </DangerButton>
    </>
  );
}

function ImagePanel({ edits, update, id, currentTime, setSelection }: InspectorProps & { id: string }) {
  const { item: img, set, remove } = useItem(edits, update, "images", id);
  if (!img) return null;
  return (
    <>
      <Section title="Image / logo">
        <div className="truncate text-xs text-ink-300">{img.file}</div>
        <Row label="Width">
          <Slider value={pct(img.w)} min={1} max={100} step={0.5} format={(v) => `${v}%`} onChange={(v) => set({ w: round3(v / 100) }, "w")} />
        </Row>
        <Row label="Opacity">
          <Slider value={Math.round(img.opacity * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => set({ opacity: v / 100 }, "opacity")} />
        </Row>
        <div className="flex flex-wrap gap-1">
          {[
            ["Top left", 0.03, 0.03],
            ["Top right", 1 - img.w - 0.03, 0.03],
            ["Bottom left", 0.03, 0.85],
            ["Bottom right", 1 - img.w - 0.03, 0.85],
          ].map(([label, x, y]) => (
            <SmallButton key={label as string} onClick={() => set({ x: round3(x as number), y: y as number }, "corner")}>
              {label}
            </SmallButton>
          ))}
        </div>
      </Section>
      <Section title="Position (% of frame)">
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <span className="w-4 text-xs text-ink-300 uppercase">{k}</span>
              <NumField value={pct(img[k])} step={0.5} min={0} max={99} suffix="%" onChange={(v) => set({ [k]: round3(v / 100) }, k)} />
            </label>
          ))}
        </div>
      </Section>
      <Section title="Time (source)">
        <TimeRows start={img.start} end={img.end} set={set} now={currentTime} duration={edits.source.duration} />
      </Section>
      <DangerButton
        onClick={() => {
          remove();
          setSelection(null);
        }}
      >
        <Trash2 size={12} /> Delete
      </DangerButton>
    </>
  );
}

function CutPanel({ edits, update, id, currentTime, setSelection }: InspectorProps & { id: string }) {
  const { item: c, set, remove } = useItem(edits, update, "cuts", id);
  if (!c) return null;
  return (
    <>
      <Section title="Cut (removed part)">
        <p className="text-xs text-ink-400">This range is removed from the export. Turn on “Skip cuts” under the video to preview without it.</p>
        <TimeRows start={c.start} end={c.end} set={set} now={currentTime} duration={edits.source.duration} />
      </Section>
      <DangerButton
        onClick={() => {
          remove();
          setSelection(null);
        }}
      >
        <Trash2 size={12} /> Remove cut (keep this part)
      </DangerButton>
    </>
  );
}

function CropPanel({ edits, update, cropAspect, setCropAspect, setSelection }: InspectorProps) {
  const W = edits.source.width;
  const H = edits.source.height;
  const crop = edits.crop;
  const setCrop = (patch: Partial<NonNullable<Edits["crop"]>>, f: string) => update((d) => (d.crop ? { ...d, crop: { ...d.crop, ...patch } } : d), `crop:${f}`);
  const px = crop ? rectPx(crop, W, H) : null;
  return (
    <>
      <Section title="Crop">
        <p className="text-xs text-ink-400">Pick a shape, then drag the frame on the video. 9:16 is for Reels / Shorts / TikTok.</p>
        <div className="flex flex-wrap gap-1">
          {CROP_ASPECTS.map((a) => (
            <SmallButton
              key={a.id}
              active={cropAspect === a.id}
              onClick={() => {
                setCropAspect(a.id);
                update((d) => ({ ...d, crop: a.ratio ? fitAspect(a.ratio, W, H) : (d.crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }) }));
              }}
            >
              {a.label}
            </SmallButton>
          ))}
        </div>
        {crop && <RectRows r={crop} set={setCrop} />}
        {px && (
          <div className="text-xs text-ink-400">
            Output: {px.w} × {px.h} px
          </div>
        )}
      </Section>
      {crop && (
        <DangerButton
          onClick={() => {
            update((d) => ({ ...d, crop: null }));
            setSelection(null);
          }}
        >
          <X size={12} /> Remove crop
        </DangerButton>
      )}
    </>
  );
}

function ProjectPanel({ edits, update, uploadAsset }: InspectorProps) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const segs = keepSegments(edits.cuts, edits.source.duration);
  const setVideo = (p: Partial<Edits["video"]>, f: string) => update((d) => ({ ...d, video: { ...d.video, ...p } }), `video:${f}`);
  const setAudio = (p: Partial<Edits["audio"]>, f: string) => update((d) => ({ ...d, audio: { ...d.audio, ...p } }), `audio:${f}`);
  const setExport = (p: Partial<Edits["export"]>, f: string) => update((d) => ({ ...d, export: { ...d.export, ...p } }), `export:${f}`);
  const music = edits.audio.music;
  const s = edits.source;

  return (
    <>
      <Section title="Project">
        <Row label="Name">
          <input className="field" value={edits.name ?? ""} onChange={(e) => update((d) => ({ ...d, name: e.target.value }), "name")} />
        </Row>
        <div className="rounded bg-ink-850 p-2 text-xs leading-5 text-ink-300">
          Source: {s.width}×{s.height}, {s.fps} fps, {s.codec}
          {s.hasAudio ? "" : ", no audio"}
          <br />
          Length: {formatTime(s.duration)} → after cuts <b className="text-ink-100">{formatTime(outputDuration(segs))}</b>
        </div>
        <p className="text-xs text-ink-400">Tip: select a tool on the left, or click an item on the video or timeline to edit it.</p>
      </Section>

      <Section title="Video fades (output)">
        <Row label="Fade in">
          <NumField value={edits.video.fadeIn} step={0.1} min={0} max={30} suffix="s" onChange={(v) => setVideo({ fadeIn: v }, "fadeIn")} />
        </Row>
        <Row label="Fade out">
          <NumField value={edits.video.fadeOut} step={0.1} min={0} max={30} suffix="s" onChange={(v) => setVideo({ fadeOut: v }, "fadeOut")} />
        </Row>
      </Section>

      <Section title="Audio">
        <Row label="Mute">
          <input type="checkbox" checked={edits.audio.mute} onChange={(e) => setAudio({ mute: e.target.checked }, "mute")} />
          <span className="text-xs text-ink-400">remove the original sound</span>
        </Row>
        {!edits.audio.mute && (
          <Row label="Volume">
            <Slider value={Math.round(edits.audio.volume * 100)} min={0} max={300} step={5} format={(v) => `${v}%`} onChange={(v) => setAudio({ volume: v / 100 }, "volume")} />
          </Row>
        )}
        <Row label="Fade in">
          <NumField value={edits.audio.fadeIn} step={0.1} min={0} max={30} suffix="s" onChange={(v) => setAudio({ fadeIn: v }, "fadeIn")} />
        </Row>
        <Row label="Fade out">
          <NumField value={edits.audio.fadeOut} step={0.1} min={0} max={30} suffix="s" onChange={(v) => setAudio({ fadeOut: v }, "fadeOut")} />
        </Row>
      </Section>

      <Section
        title="Background music"
        right={
          music && (
            <button className="text-xs text-red-300 hover:underline" onClick={() => setAudio({ music: null }, "music")}>
              Remove
            </button>
          )
        }
      >
        {music ? (
          <>
            <div className="flex items-center gap-2 truncate text-xs text-ink-200">
              <Music size={14} /> {music.file.replace(/^assets\//, "")}
            </div>
            <Row label="Volume">
              <Slider value={Math.round(music.volume * 100)} min={0} max={200} step={5} format={(v) => `${v}%`} onChange={(v) => setAudio({ music: { ...music, volume: v / 100 } }, "musicVol")} />
            </Row>
            <Row label="Loop">
              <input type="checkbox" checked={music.loop} onChange={(e) => setAudio({ music: { ...music, loop: e.target.checked } }, "loop")} />
              <span className="text-xs text-ink-400">repeat if shorter than the video</span>
            </Row>
          </>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBusy(true);
                try {
                  const file = await uploadAsset(f);
                  setAudio({ music: { file, volume: 0.3, loop: true } }, "music");
                } finally {
                  setBusy(false);
                }
              }}
            />
            <SmallButton onClick={() => fileRef.current?.click()}>
              <Upload size={12} /> {busy ? "Uploading…" : "Add music (MP3, WAV, M4A…)"}
            </SmallButton>
          </>
        )}
      </Section>

      <Section title="Export defaults">
        <Row label="Resolution">
          <select className="field" value={String(edits.export.height)} onChange={(e) => setExport({ height: e.target.value === "null" ? null : (Number(e.target.value) as 1080) }, "height")}>
            {EXPORT_HEIGHTS.map((h) => (
              <option key={String(h)} value={String(h)}>
                {h ? `${h}p` : "Original"}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Quality">
          <select className="field" value={edits.export.quality} onChange={(e) => setExport({ quality: e.target.value as "high" }, "quality")}>
            <option value="high">High (big file)</option>
            <option value="medium">Medium</option>
            <option value="small">Small file</option>
          </select>
        </Row>
      </Section>
    </>
  );
}
