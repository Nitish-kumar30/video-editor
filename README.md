# ClipForge

A simple video editor that runs **on your own computer**: cut, blur or pixelate faces and
number plates, hide things with boxes, add text and your logo, crop to 9:16 for
Reels/Shorts, fade in/out, adjust the sound, add music, and export an MP4.

- Your videos never leave your PC. No accounts, no cloud, no fees.
- FFmpeg (the engine that does the real video work) is installed for you automatically.
- Built to be customized by chatting with an AI assistant (Claude Code, Cursor…) — both
  your edits and the app itself.

---

## 1. One-time setup

### Install Node.js
1. Go to **https://nodejs.org** and download the **LTS** version (the left/green button).
2. Run the installer and keep clicking *Next* (the defaults are fine).
3. Check it worked: open a terminal (Windows: press <kbd>Win</kbd>, type **PowerShell**,
   press Enter; Mac: open **Terminal**) and type:
   ```
   node -v
   ```
   You should see something like `v22.x.x` (version 20.9 or newer is needed).

### Get ClipForge
Either:
- **With Git** (install from https://git-scm.com if you don't have it):
  ```
  git clone https://github.com/<your-account>/video-editor.git
  cd video-editor
  ```
- **Or without Git:** on the GitHub page click **Code → Download ZIP**, unzip it, then in the
  terminal go into the folder, e.g. `cd "C:\Users\me\Downloads\video-editor"`.

### Install the app's parts
In that folder run:
```
npm install
```
This takes a minute and also downloads FFmpeg (~70 MB). You only do this once
(and again after pulling updates).

## 2. Start the editor

```
npm run dev
```
Wait for `Ready`, then open **http://localhost:3000** in Chrome or Edge.
Leave the terminal window open while you edit; press <kbd>Ctrl</kbd>+<kbd>C</kbd> in it to stop.

## 3. Edit a video (the everyday workflow)

1. **Drop your video** on the home page (or click to choose it). Any size works; phone videos
   too. The video is *copied* into `projects/<name>/` — your original is never changed.
2. **Edit** in the editor:
   | To… | Do this |
   |---|---|
   | Cut out a part | Move to the start, press **I**; move to the end, press **O**; press **C**. The removed part shows red-striped on the timeline. |
   | Blur / pixelate a face, plate, phone number | Pick **Blur** or **Pixelate** on the left, drag a rectangle on the video. It lasts 5 s from the playhead (or from In to Out if you set them) — drag the bar on the timeline, or its ends, to change when. |
   | Hide something completely | **Box** tool, drag a rectangle. Pick the color on the right. |
   | Add text | **Text** tool, click on the video, type on the right. |
   | Add your logo | **Logo** tool, choose a PNG (transparent PNGs look best). Use the corner buttons on the right. |
   | Make it vertical (Reels/Shorts/TikTok) | **Crop** tool → **9:16**, then drag the frame to keep the important part. |
   | Fades, volume, mute, background music | Click an empty spot on the video (nothing selected) — the settings are on the right. |
3. **Export**: click **Export** (top right), choose resolution/quality, **Start export**, then
   **Download**. Exports are also saved in `projects/<name>/exports/`.

**Not sure what something does?** Rest the mouse on it for a moment — a help bubble explains
it. The **?** button in the top bar switches these tips off and on.

Everything saves automatically. **Undo/Redo**: <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>.

### Keyboard shortcuts
| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | One frame back / forward (hold Shift for 1 second) |
| I / O | Set In / Out mark |
| C | Cut out the part between In and Out |
| B | New blur at the playhead |
| T | New text at the playhead |
| Delete | Remove the selected item |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Esc | Deselect, back to the Select tool |
| Ctrl + mouse wheel | Zoom the timeline |

Tip: keep **“Skip cuts while previewing”** on to watch the video as it will be exported.

## 4. Editing with an AI assistant

Every edit is stored in one readable file: `projects/<name>/edits.json`. Open this folder
in VS Code/Cursor with Claude Code (or Cursor's chat) and just ask, for example:

- “Cut 1:20 to 1:45.”
- “Blur the top-right corner from 0:30 to 0:50.”
- “Add my logo (C:\Users\me\logo.png) bottom-right at 70% opacity.”
- “Make it 9:16.”
- “Mute the sound and add assets/song.mp3 quietly in the background.”

The AI edits `edits.json`; **the open editor updates by itself within ~2 seconds** (and you
can undo it with Ctrl+Z). The AI can also change the app itself (“add a button that…”) —
`CLAUDE.md` explains the code to it.

### Command line (optional)
```
npm run new -- "C:\Videos\my clip.mp4"   # create a project from a file
npm run render -- my-clip                # export without opening the app (same result as the button)
npm run render -- my-clip --height 720 --quality medium --name final
npm run sample                           # a 20-second test video to play with
npm test                                 # run the automatic checks
```
Project ids are the folder names inside `projects/`.

## 5. Keeping a clean “base version”

The `projects/` folder is **not** saved to Git (it's in `.gitignore`), so your videos stay
private and the repository stays small. A good routine:

- Keep `main` as your base version of the app.
- If you want app changes for one particular video, make a branch first:
  `git checkout -b video/holiday-2025`, let the AI change the app there, and merge
  the changes you like back into `main` later.
- Pull improvements into a new video's work with `git checkout main && git pull`.

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `npm` is not recognized | Close and reopen the terminal after installing Node.js (or restart Windows). |
| Port 3000 is already in use | Another `npm run dev` is still running — close it, or run `npm run dev -- -p 3001` and open http://localhost:3001. |
| “FFmpeg binary not found” | Run `npm install` again. Antivirus software sometimes quarantines `node_modules\ffmpeg-static\ffmpeg.exe` — allow it. Or install FFmpeg yourself and set `FFMPEG_PATH` (e.g. PowerShell: `$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"; npm run dev`). |
| A phone video (HEVC/iPhone) shows a message about a preview | Normal: browsers can't always play HEVC, so a 720p preview copy is made in the background. Exports always use the original, full-quality file. |
| The video won't play at all | Use Chrome or Edge. Very unusual formats: convert once with any converter to MP4, or let the preview finish. |
| “edits.json has a typo” banner | Someone (or an AI) saved invalid JSON. Fix the file (often a missing comma) — the editor reloads it automatically. |
| iPhone HDR video looks a bit washed out after export | Exports are standard (SDR) MP4s and v1 doesn't tone-map HDR. On the iPhone, set Camera → Formats → *Most Compatible* or turn off *HDR Video* for clips you plan to edit. |
| Export failed | The Export window shows the last FFmpeg messages. `npm run render -- <id>` in a terminal shows the same. |

## 7. Defaults and decisions (so nothing is a surprise)

- **Runs only on your computer**: the server listens on `localhost`, so other devices on your
  network can't open your projects. Next.js telemetry is switched off (see `scripts/next.mjs`).
  The app makes no internet requests. (Only the Next.js *development* server checks npm for a
  newer Next.js version in the background; it works fine offline, and `npm run build && npm start`
  doesn't do it.)
- **Your original file is copied**, never modified. Deleting a project deletes the copy, its
  edits and exports — not your original.
- **Exports**: H.264 MP4 + AAC 192 kb/s, CRF 18/23/28 for high/medium/small, constant frame
  rate equal to the source, web-optimized (`faststart`). **Metadata such as GPS location is
  removed** from exports. Existing exports are never overwritten (`name (2).mp4`).
- **Blur strength** 1–100 maps to a blur radius of up to 4% of the video height;
  **pixelate** blocks up to 5% of the height. New blur/text items last 5 s from the playhead
  (or In→Out if both marks are set); logos last the whole video.
- **Text** uses the bundled DejaVu Sans font (free license, `public/fonts/`), the same in the
  preview and the export. FFmpeg builds without the `drawtext` filter (e.g. the Linux
  ffmpeg-static build) automatically use the `ass` subtitle filter instead — same result.
- **Music** starts at the beginning of the exported video, loops by default, at 30% volume.
- **Phone videos**: rotation is handled; HEVC / ProRes / 10-bit videos get a 720p H.264
  preview for the browser. Thumbnails of videos longer than 2 minutes use keyframes only
  (much faster).
- **Live sync** checks `edits.json` every 1.5 s. If you're in the middle of changing something
  in the editor, your change wins and is saved.
- Render jobs live in memory: if you stop the server during an export, just export again.

## 8. For developers

Next.js 16 (App Router, TypeScript) + Tailwind CSS 4 + lucide-react; FFmpeg via
`ffmpeg-static`; tests with Vitest. Architecture, schema and conventions are in
**[CLAUDE.md](CLAUDE.md)**. `npm test` runs unit tests and real renders on generated clips;
`npm run typecheck` and `npm run build` should stay clean.

License notes: ClipForge's code is yours to use. DejaVu Sans is under the Bitstream Vera /
public-domain license (`public/fonts/DejaVuSans-LICENSE.txt`). FFmpeg binaries from
`ffmpeg-static` are GPL-licensed builds of FFmpeg.
