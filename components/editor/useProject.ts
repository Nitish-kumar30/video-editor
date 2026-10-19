"use client";
/**
 * Editor state for one project: loads edits.json, keeps an undo/redo history,
 * autosaves (debounced ~500 ms) and live-syncs changes made to edits.json outside
 * the app (by you or an AI assistant in your IDE) — those become an undo step too.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { normalize, type Edits } from "@/lib/schema";
import type { MediaStatus, UpdateEdits } from "./types";

export type SaveStatus = "loading" | "saved" | "saving" | "unsaved" | "synced" | "error";

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1200;
const SAVE_DELAY = 500;
const POLL_MS = 1500;

export function useProject(id: string) {
  const [edits, setEditsState] = useState<Edits | null>(null);
  const [media, setMedia] = useState<MediaStatus | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const present = useRef<Edits | null>(null);
  const past = useRef<Edits[]>([]);
  const future = useRef<Edits[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const lastMtime = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((next: Edits) => {
    present.current = next;
    setEditsState(next);
  }, []);

  // ---- saving -------------------------------------------------------------
  const save = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!dirty.current || !present.current) return;
    if (saving.current) {
      saveTimer.current = setTimeout(save, SAVE_DELAY);
      return;
    }
    saving.current = true;
    dirty.current = false;
    setStatus("saving");
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(present.current),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      lastMtime.current = data.mtime;
      setStatus(dirty.current ? "unsaved" : "saved");
      setError(null);
    } catch (e) {
      dirty.current = true;
      setStatus("error");
      setError((e as Error).message);
    } finally {
      saving.current = false;
    }
  }, [id]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setStatus("unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY);
  }, [save]);

  // ---- history ------------------------------------------------------------
  const update: UpdateEdits = useCallback(
    (fn, coalesce) => {
      const cur = present.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      const now = Date.now();
      const merge = coalesce && lastKey.current?.key === coalesce && now - lastKey.current.at < COALESCE_MS;
      if (!merge) {
        past.current.push(cur);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
      }
      future.current = [];
      lastKey.current = coalesce ? { key: coalesce, at: now } : null;
      apply(next);
      scheduleSave();
    },
    [apply, scheduleSave],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !present.current) return;
    future.current.push(present.current);
    lastKey.current = null;
    apply(prev);
    scheduleSave();
  }, [apply, scheduleSave]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !present.current) return;
    past.current.push(present.current);
    lastKey.current = null;
    apply(next);
    scheduleSave();
  }, [apply, scheduleSave]);

  /** Save now and wait until everything is on disk (used before exporting). */
  const flush = useCallback(async () => {
    for (let i = 0; i < 50 && (dirty.current || saving.current); i++) {
      if (!saving.current) await save();
      else await new Promise((r) => setTimeout(r, 100));
    }
  }, [save]);

  // ---- initial load ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load project");
        if (cancelled) return;
        lastMtime.current = data.mtime;
        setMedia(data.media);
        apply(normalize(data.edits));
        setStatus("saved");
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

  // ---- live sync: notice edits.json changes made outside the app -------------
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!present.current || dirty.current || saving.current) return;
      try {
        const res = await fetch(`/api/projects/${id}?meta=1`, { cache: "no-store" });
        if (!res.ok) return;
        const meta = await res.json();
        if (meta.media) setMedia(meta.media);
        setJsonError(meta.invalid ?? null);
        if (meta.invalid || meta.mtime === lastMtime.current) return;
        const full = await fetch(`/api/projects/${id}`, { cache: "no-store" });
        if (!full.ok) return;
        const data = await full.json();
        if (dirty.current || saving.current) return; // the user edited meanwhile; their save wins
        lastMtime.current = data.mtime;
        const incoming = normalize(data.edits);
        if (JSON.stringify(incoming) === JSON.stringify(present.current)) return;
        past.current.push(present.current!);
        future.current = [];
        lastKey.current = null;
        apply(incoming);
        setStatus("synced");
      } catch {
        /* server restarting — try again next tick */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, apply]);

  // Save right away when leaving the page.
  useEffect(() => {
    const flush = () => {
      if (dirty.current && present.current) {
        fetch(`/api/projects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(present.current),
          keepalive: true,
        });
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [id]);

  return {
    edits,
    media,
    status,
    error,
    jsonError,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    flush,
  };
}
