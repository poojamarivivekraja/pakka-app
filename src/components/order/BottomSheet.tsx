"use client";

import { useEffect, useRef } from "react";

// A bottom sheet in the app column: the backdrop covers the window, the sheet sits in the column. Backdrop, Escape and backdrop click close it.
export function BottomSheet({ open, onClose, label, children }: {
  open: boolean; onClose: () => void; label: string; children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind stays put
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" aria-hidden onClick={onClose} />
      <div className="app-column-layer bottom-0 max-h-dvh">
      <div
        ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="app-column max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] outline-none"
      >
        {children}
      </div>
      </div>
    </div>
  );
}
