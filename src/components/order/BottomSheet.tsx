"use client";

import { useEffect, useRef } from "react";

// A bottom sheet in the 420px column: backdrop, Escape and backdrop click close it.
export function BottomSheet({ open, onClose, label, children }: {
  open: boolean; onClose: () => void; label: string; children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/40" aria-hidden />
      <div
        ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88vh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl bg-surface p-5 outline-none"
      >
        {children}
      </div>
    </div>
  );
}
