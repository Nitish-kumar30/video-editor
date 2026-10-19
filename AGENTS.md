# ClipForge — guide for AI assistants (Claude Code, Cursor, Codex…)

ClipForge is a **local video editor**: a Next.js app that runs on the user's PC, with all
real video processing done by **native FFmpeg**. The user is a beginner at video
editing. They will ask you, in plain words, either to **edit a video** ("cut 1:20 to
1:45", "blur the number plate") or to **change the app itself** ("add a speed
control"). Keep the code simple and well commented. Explain what you did in plain language.

> `AGENTS.md` is a copy of this file and `.cursor/rules/editor.mdc` points here.
> If you change this file, copy it to `AGENTS.md` too (`cp CLAUDE.md AGENTS.md`).

---

## 1. The most important rule: to edit a video, edit `edits.json`

Every video is a project folder:

```
projects/<projectId>/
  source.<ext>     the original video (never modified)
  edits.json       ← THE SINGLE SOURCE OF TRUTH for the edit
  assets/          logos, images, music used by the edit
  thumbs.jpg       timeline thumbnail strip (generated)
  preview.mp4      browser-friendly copy, only for HEVC/ProRes/10-bit sources (generated)
  exports/         rendered MP4s
  .tmp/            scratch files
```

- **To change an edit, change `projects/<id>/edits.json`.** The open editor polls the file
  every ~1.5 s and reloads it automatically (shown as "Synced from edits.json", and it is
  undoable in the editor with Ctrl+Z). You do not need the UI or a server to edit.
- **Which project?** If the user doesn't say, use the most recently modified
  `projects/*/edits.json` (they usually mean the video they are working on) and say which one you picked.
- `edits.json` is forgiving. On load, `normalize()` in `lib/schema.ts` fills missing fields,
  clamps values, fixes reversed ranges and adds missing `id`s. Times may be numbers
  (`80.5`) or strings (`"1:20.5"`). You may omit `id`.
- **Never edit the `source` block.** It is filled by probing the video.
- Assets (logos, music) must be inside the project's `assets/` folder and referenced as
  `"assets/<file>"`. If the user gives a path elsewhere on disk, **copy** the file into
  `assets/` first.
- To produce the MP4: `npm run render -- <projectId>` (same result as the Export button).

## 2. Architecture (do not change without asking the user)

- **Next.js (App Router, TypeScript) + Tailwind CSS**, run with `npm run dev`
  (binds to localhost only).
- **The browser never processes video.** The UI only previews and records decisions into
  `edits.json`.
- **All real editing is native FFmpeg**, run on the server side (route handlers) and by the
  CLI scripts, both using the shared `lib/`. FFmpeg comes from the `ffmpeg-static` npm
  package (override with the `FFMPEG_PATH` env var). It is listed in `serverExternalPackages`.
- **No cloud, no accounts, no database, no telemetry, no network calls at runtime.**
- FFmpeg is always spawned with an **args array (no shell)**, with the **project folder as
  the working directory** and **relative paths** in the filter graph. This keeps paths with
  spaces and Windows drive letters (`C:`) out of trouble.
- Uploads are **streamed to disk**; never buffer a whole video in memory (1 GB+ files are normal).

### File map

| Path | What it does |
|---|---|
| `lib/schema.ts` | Types for `edits.json`, defaults, `normalize()`, time/color helpers. Browser-safe. |
| `lib/timeline.ts` | Cut math: keep segments, output duration, source→output time. Browser-safe. |
| `lib/render.ts` | **Pure** function `buildRender(edits)` → FFmpeg args + filter graph. Unit tested. Browser-safe. |
| `lib/export.ts` | `renderProject(id)`: writes helper files, runs FFmpeg. Used by API **and** CLI. |
| `lib/ffmpeg.ts` | FFmpeg path, `probe()` (parses `ffmpeg -i` output, handles rotation), `runFfmpeg()` with progress. |
| `lib/media.ts` | New source video: probe, default `edits.json`, thumbnails, preview proxy. |
| `lib/storage.ts` | Project paths, read/write `edits.json` (atomic), safe path resolving. |
| `lib/jobs.ts` | In-memory background job registry (on `globalThis`, survives hot reload). |
| `app/page.tsx` | Home: project cards + drag-and-drop upload. |
| `app/editor/[id]/page.tsx` | Editor page → `components/editor/Editor.tsx`. |
| `app/api/projects/...` | REST API (see below). |
| `components/editor/` | `Editor` (layout, playback, shortcuts), `Stage` (video + overlay previews, drawing, handles), `Timeline`, `Inspector`, `Toolbar`, `ExportDialog`, `useProject` (undo/redo, autosave, live sync), `geometry` (rect math). |
| `scripts/` | CLI: `new-project.ts`, `render.ts`, `sample.ts`; `next.mjs` starts Next with telemetry off. |
| `public/fonts/DejaVuSans.ttf` | The one font used by the preview **and** FFmpeg (so they match). |
| `tests/` | Vitest: schema, timeline, probe parsing, filter-graph strings, and real renders. |

### API

| Method & path | Purpose |
|---|---|
| `GET/POST /api/projects` | list / create (`{name}` → `{id}`) |
| `GET /api/projects/<id>` | `{ edits, mtime, media }`; `?meta=1` → `{ mtime, media, invalid? }` (polled for live sync) |
| `PUT /api/projects/<id>` | save edits (normalized; `source` is protected) |
| `DELETE /api/projects/<id>` | delete the project folder |
| `PUT /api/projects/<id>/upload?kind=source\|asset&name=<file>` | raw body streamed to disk |
| `GET /api/projects/<id>/file/<path>` | serve a project file with HTTP Range; `?download=1` to download |
| `POST/GET/DELETE /api/projects/<id>/render` | start / poll (`{job, exports}`) / cancel a render |

Next.js 16 note: route `params` are a **Promise** (`const { id } = await params`).

## 3. Conventions — read before touching `edits.json`

**Time**
- All item times (`cuts`, `regions`, `texts`, `images`: `start`, `end`) are **seconds on the
  ORIGINAL source timeline** — the time the user sees in their video player.
  Cutting part of the video does **not** shift other items' times.
- Exceptions on the **output** timeline (after cuts): `video.fadeIn/fadeOut`,
  `audio.fadeIn/fadeOut`, and the background music (which starts at output 0).
- `cuts` are ranges to **REMOVE**. Overlapping cuts are merged; leftover pieces shorter than
  0.05 s are dropped.

**Position & size**
- Everything is **normalized 0–1 relative to the source frame** (resolution independent).
  `x=0,y=0` is the top-left corner; `w=1` is the full width; `h=1` the full height.
- Phone videos: width/height are the *displayed* size (already swapped for 90° rotation).
- `texts[].x,y` is the top-left of the text. `texts[].size` = font size as a fraction of
  the video **height** (0.06 ≈ 6%, a good subtitle size).
- `images[].w` = width as a fraction of the video **width**; the height follows the image's
  own aspect ratio.
- `crop` is also normalized to the source frame. For an aspect ratio `A` (e.g. 9/16) on a
  `W×H` source, the crop's normalized `w/h` must equal `A * H / W`.

## 4. `edits.json` schema (v1)

```ts
{
  version: 1,
  name?: string,                       // shown on the home page
  source:  { file, width, height, duration, fps, hasAudio, codec },   // READ-ONLY (from probe)
  cuts:    [{ id, start, end }],                                       // ranges to REMOVE
  regions: [{ id, type: "blur"|"pixelate"|"box", x, y, w, h, start, end,
              strength /*1-100, blur & pixelate*/, color /*"#rrggbb", box*/, label? }],
  texts:   [{ id, text /*"\n" for new lines*/, x, y, size, color,
              background: "#rrggbb"|null, bgOpacity /*0-1*/, start, end }],
  images:  [{ id, file /*"assets/..."*/, x, y, w, opacity /*0-1*/, start, end }],
  crop:    { x, y, w, h } | null,
  video:   { fadeIn, fadeOut },                                         // seconds, output timeline
  audio:   { mute, volume /*1 = 100%, max 4*/, fadeIn, fadeOut,
             music: { file /*"assets/..."*/, volume, loop } | null },
  export:  { height: null|1080|720|480, quality: "high"|"medium"|"small", filename? }
}
```

Defaults if you leave things out: region `strength` 50, box `color` `#000000`, text
`size` 0.06, `color` `#ffffff`, `bgOpacity` 0.6, image `w` 0.15, `opacity` 1, music
`volume` 0.3 and `loop` true, `export.quality` `"high"`, missing `end` = end of video.
Colors may be `#rgb`, `#rrggbb`, `0xrrggbb` or simple names (`red`, `black`…).

### Complete example (1920×1080, 3-minute source)

```json
{
  "version": 1,
  "name": "Road trip",
  "source": { "file": "source.mp4", "width": 1920, "height": 1080, "duration": 180, "fps": 30, "hasAudio": true, "codec": "h264" },
  "cuts": [{ "id": "cut_intro", "start": 0, "end": 4.5 }, { "id": "cut_1", "start": 80, "end": 105 }],
  "regions": [
    { "id": "plate", "type": "blur", "x": 0.62, "y": 0.70, "w": 0.12, "h": 0.06, "start": 30, "end": 50, "strength": 70, "label": "number plate" },
    { "id": "phone", "type": "box", "x": 0.05, "y": 0.10, "w": 0.25, "h": 0.05, "start": 60, "end": 64, "color": "#000000" }
  ],
  "texts": [{ "id": "title", "text": "Day 1", "x": 0.05, "y": 0.80, "size": 0.08, "color": "#ffffff", "background": "#000000", "bgOpacity": 0.5, "start": 5, "end": 9 }],
  "images": [{ "id": "logo", "file": "assets/logo.png", "x": 0.82, "y": 0.84, "w": 0.15, "opacity": 0.7, "start": 0, "end": 180 }],
  "crop": null,
  "video": { "fadeIn": 0.5, "fadeOut": 1 },
  "audio": { "mute": false, "volume": 1, "fadeIn": 0, "fadeOut": 1.5, "music": { "file": "assets/song.mp3", "volume": 0.25, "loop": true } },
  "export": { "height": 1080, "quality": "high", "filename": "road-trip" }
}
```

## 5. Recipes for common requests

Always read the current `edits.json` first, change only what was asked, keep the other
items, and write valid JSON (2-space indent). Then tell the user what changed — and that the
open editor will update within ~2 seconds.

- **"Cut 1:20 to 1:45"** → append to `cuts`: `{ "start": 80, "end": 105 }`
  (1:20 = 80 s, 1:45 = 105 s; `"1:20"` strings also work). Times are on the original video.
- **"Remove the first 5 seconds"** → `{ "start": 0, "end": 5 }`. **"…the last 10 s"** →
  `{ "start": duration - 10, "end": duration }` (use `source.duration`).
- **"Blur the top-right corner from 0:30 to 0:50"** → append to `regions`:
  `{ "type": "blur", "x": 0.75, "y": 0, "w": 0.25, "h": 0.25, "start": 30, "end": 50, "strength": 60 }`.
  Corners: top-left `x:0,y:0` · top-right `x:1-w,y:0` · bottom-left `x:0,y:1-h` · bottom-right `x:1-w,y:1-h`.
  "Pixelate" → `type: "pixelate"`. "Hide with a black box" → `type: "box", color: "#000000"`.
  If the user gives a pixel position, divide by `source.width` / `source.height`.
- **"Add my logo bottom-right at 70% opacity"** → copy the logo into `assets/` if needed, then
  append to `images`: `{ "file": "assets/logo.png", "x": 0.82, "y": 0.8, "w": 0.15, "opacity": 0.7, "start": 0, "end": <source.duration> }`.
  Tip: `x = 1 - w - 0.03` keeps a small margin. The image height depends on its aspect
  ratio, so for an exact bottom margin compute `y = 1 - 0.03 - (w * W * imgH / imgW) / H`.
- **"Make it 9:16" (Reels/Shorts/TikTok)** on a landscape `W×H` source →
  `w = (9/16) * H / W`, `h = 1`, `x = (1 - w) / 2`, `y = 0`. For 1920×1080:
  `"crop": { "x": 0.342, "y": 0, "w": 0.316, "h": 1 }`. Optionally `export.height: 1080`.
  Other shapes: 1:1 → `w = H / W`; 4:5 → `w = 0.8 * H / W`. Move `x` to follow the subject.
  Remember that texts/logos are positioned on the *source* frame, so after cropping, move them
  inside the crop rectangle (e.g. `x` between `crop.x` and `crop.x + crop.w - itemWidth`).
- **"Add a title 'Hello' for the first 3 seconds"** → append to `texts`:
  `{ "text": "Hello", "x": 0.05, "y": 0.05, "size": 0.08, "start": 0, "end": 3 }`.
- **"Mute the original sound and add music"** → `audio.mute: true`, `audio.music: { "file": "assets/song.mp3", "volume": 1, "loop": true }`.
- **"Fade in and out"** → `video.fadeIn: 1, video.fadeOut: 1` (and `audio.fadeOut: 1`).
- **"Export smaller"** → `export.quality: "small"` and/or `export.height: 720`.
- **"Render it" / "export it"** → `npm run render -- <projectId>`; the file lands in
  `projects/<id>/exports/`.

When you can't see the video, ask the user for times and rough positions, or extract a
frame to look at: `node -p "require('ffmpeg-static')"` prints the bundled FFmpeg path (or use
`FFMPEG_PATH` if set); then `<ffmpeg> -ss 30 -i projects/<id>/source.mp4 -frames:v 1 frame.png`
and open the PNG.

## 6. Commands

```bash
npm run dev                         # app at http://localhost:3000
npm run new -- "C:\path\video.mp4"  # new project from a file (prints the project id)
npm run sample                      # new 20 s test-pattern project (id "sample", "sample-2", …)
npm run render -- <projectId>       # render to projects/<id>/exports/
npm run render -- <id> --height 720 --quality medium --name final
npm run render -- <id> --print      # just print the FFmpeg command
npm test                            # unit tests + real renders on generated clips (~10 s)
npm run typecheck
npm run build
```

### Testing a render change quickly

1. `npm run sample -- 6` (6-second clip; note the printed id).
2. Edit `projects/<id>/edits.json` to use your feature.
3. `npm run render -- <id> --print` to inspect the filter graph, then `npm run render -- <id>`.
4. Look at a frame: `<ffmpeg> -ss 2 -i "projects/<id>/exports/<name>.mp4" -frames:v 1 check.png`.
5. Add a string test in `tests/render.test.ts` and, for anything visual, a real-render
   check in `tests/render.e2e.test.ts` (helpers in `tests/helpers.ts` read pixels/audio).
6. `npm test`.

## 7. Adding a new effect (the path every feature takes)

1. **`lib/schema.ts`** — add the fields/type, a default, and handle it in `normalize()`
   (it must accept missing/garbage values without throwing). Keep `version: 1` for
   additive changes; bump it only for breaking changes and migrate old files in `normalize()`.
2. **`lib/render.ts`** — emit the FFmpeg filter in `buildRender()` at the right pipeline
   step (source-timeline effects go *before* the cuts step and use
   `enable='between(t,start,end)'`; output-timeline effects go *after*). Keep it pure.
   Use relative paths and write any helper files via the `files` array.
3. **`components/editor/Stage.tsx`** — a live CSS/canvas preview, shown only within the time
   range (selected items always show, semi-transparent).
4. **`components/editor/Inspector.tsx`** — fields for the new properties (use `update(fn, coalesceKey)`
   so edits are undoable and typing coalesces into one step). Add a timeline lane in
   `Timeline.tsx` if it has a time range, and a tool in `Toolbar.tsx` if it's drawn.
5. **Tests** — string test + real render. Update this file's schema section (and AGENTS.md).

## 8. Gotchas (learned the hard way)

- **boxblur** errors if the radius is too big for the area: luma radius < min(w,h)/2, chroma
  radius < min(w,h)/4. `blurRadii()` clamps it.
- **Even pixel values** for crop/regions (yuv420p chroma); `rectPx()` does this.
- **Text**: `drawtext` with `textfile=` and `expansion=none` (no escaping problems). Some
  FFmpeg builds — including the Linux `ffmpeg-static` binary — have no `drawtext`; then
  `lib/export.ts` switches automatically to the `ass` (libass) filter with the same font and
  layout. `FONT_ASCENT` / `FONT_LINE_HEIGHT` in `lib/render.ts` keep preview and export aligned.
- **Cuts** use `split → trim/atrim → concat`, not `select`, so audio stays in sync on
  variable-frame-rate phone videos (tested in `tests/render.e2e.test.ts`). Output is forced to
  constant frame rate with `-r <fps>`.
- **Images** are overlaid with `eof_action=repeat` (a still PNG lasts the whole video). Do not
  add `-loop 1` (the render would never end).
- **Music** uses `-stream_loop -1` when looping and is trimmed to the output duration; mixing
  uses `amix=normalize=0` so the original audio isn't halved.
- Long filter graphs (> 6000 chars) go to `.tmp/graph.txt` via `-filter_complex_script`
  (Windows command-line length limit).
- Exports drop source metadata (`-map_metadata -1`) — phone videos often carry GPS location.
- `lib/schema.ts`, `lib/timeline.ts` and `lib/render.ts` are imported by the browser: no
  Node imports there.
- `lib/jobs.ts` is in-memory: restarting the server forgets running jobs (files stay).
- Windows: paths with spaces work because nothing goes through a shell. Don't introduce
  `exec`/shell strings.

## 9. Not in v1 — how to add later

- **Moving / tracked blur (follows a face).** Add optional `keyframes: [{ t, x, y, w, h }]` to
  `Region` in `lib/schema.ts`. In `lib/render.ts`, build piecewise-linear expressions
  for `crop` and `overlay` positions (both accept expressions of `t`, e.g.
  `x='if(lt(t,2),100+(t-0)*50, …)'`; crop's `w/h` can't change per frame, so use the largest
  size). In `Stage.tsx`, interpolate the keyframes at `currentTime`, and add "add keyframe at
  playhead" in `Inspector.tsx`. Automatic face tracking would be a separate offline script
  that writes these keyframes.
- **Auto-captions / subtitles.** Add `captions: [{ start, end, text }]` (or a `.srt` in
  `assets/`). Render with the `subtitles` / `ass` filter (see `buildAss()` in
  `lib/render.ts`). Speech-to-text must stay local (e.g. whisper.cpp as an optional
  CLI step that writes captions into `edits.json`).
- **Speed changes.** Add `speed: [{ start, end, rate }]`. In the cuts step, give each keep
  segment its rate: `setpts=(PTS-STARTPTS)/rate` and `atempo=rate` (chain atempo for rates
  outside 0.5–2). Update `lib/timeline.ts` (output duration and source→output mapping) and
  the preview's `playbackRate`.
- **Multi-clip timelines.** Generalise `source` to `sources: []` and keep segments to
  `{ source, start, end }`; each source becomes an input, and `concat` already joins
  segments. The UI timeline would show clips in sequence. This is a schema version 2 change.
- **Transitions between clips.** Replace `concat` for a pair of segments with
  `xfade=transition=fade:duration=d:offset=o` (video) and `acrossfade=d=d` (audio); the
  output duration shrinks by `d` per transition — update `lib/timeline.ts`.
