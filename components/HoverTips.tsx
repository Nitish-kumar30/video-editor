"use client";
/**
 * Hover help for the whole app.
 *
 * Give any element a `data-tip="What this does"` attribute (and optionally
 * `data-tip-title="Name"`). When the mouse rests on it for TIP_DELAY ms, a help
 * bubble appears next to it. It disappears when the mouse moves on, clicks, or
 * scrolls. Tips can be switched off with the "?" button in the editor's top bar
 * (remembered in this browser via localStorage).
 *
 * One listener on the document handles every tip, so components only need the
 * data attributes — no wrapper components.
 */
import { useEffect, useRef, useState } from "react";

/** How long the mouse must rest on something before its help appears. */
export const TIP_DELAY = 700;
/** Moving the mouse more than this many pixels hides a visible tip. */
const MOVE_TOLERANCE = 12;
const STORAGE_KEY = "clipforge.tips";

export function tipsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setTipsEnabled(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* private mode: just don't remember */
  }
  window.dispatchEvent(new Event("clipforge-tips"));
}

interface Tip {
  title: string | null;
  text: string;
  /** Target element's box on screen. */
  rect: DOMRect;
}

export default function HoverTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let target: HTMLElement | null = null;
    let shownAt: { x: number; y: number } | null = null;
    let enabled = tipsEnabled();

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const hide = () => {
      clear();
      shownAt = null;
      setTip(null);
    };

    const onMove = (e: PointerEvent) => {
      if (!enabled || e.pointerType === "touch") return;
      // Never pop up while dragging something.
      if (e.buttons) return hide();
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (shownAt) {
        // A tip is visible: keep it while the mouse stays on the same thing and nearby.
        if (el === target && Math.hypot(e.clientX - shownAt.x, e.clientY - shownAt.y) < MOVE_TOLERANCE) return;
        hide();
      }
      target = el;
      clear();
      if (!el) return;
      const x = e.clientX;
      const y = e.clientY;
      // Restart the countdown on every move: the tip shows once the mouse rests.
      timer = setTimeout(() => {
        if (!target || !document.contains(target)) return;
        const text = target.dataset.tip;
        if (!text) return;
        shownAt = { x, y };
        setTip({ title: target.dataset.tipTitle ?? null, text, rect: target.getBoundingClientRect() });
      }, TIP_DELAY);
    };

    const onToggle = () => {
      enabled = tipsEnabled();
      if (!enabled) hide();
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("wheel", hide, { passive: true, capture: true });
    document.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("clipforge-tips", onToggle);
    return () => {
      clear();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("wheel", hide, true);
      document.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("clipforge-tips", onToggle);
    };
  }, []);

  // Place the bubble below the element (or above if there is no room), kept on screen.
  useEffect(() => {
    if (!tip || !bubbleRef.current) return setPos(null);
    const b = bubbleRef.current.getBoundingClientRect();
    const gap = 8;
    const r = tip.rect;
    let top = r.bottom + gap;
    if (top + b.height > window.innerHeight - 4) top = r.top - b.height - gap;
    // Big areas (the video, the timeline): show near their top instead of off-screen.
    if (top < 4) top = Math.max(4, r.top + gap);
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - b.width - 6));
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={bubbleRef}
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-xs rounded-lg border border-ink-500 bg-ink-850/95 px-3 py-2 text-xs leading-relaxed text-ink-100 shadow-2xl backdrop-blur-sm"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {tip.title && <div className="mb-0.5 font-semibold text-white">{tip.title}</div>}
      <div className="whitespace-pre-line">{tip.text}</div>
    </div>
  );
}
