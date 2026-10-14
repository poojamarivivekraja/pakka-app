"use client";

import { useCallback, useSyncExternalStore } from "react";

// "Simulate sync paused": a browser-wide switch (localStorage), shared by every screen and tab.

const KEY = "pakka_sync_paused";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // changes made in another tab
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** [paused, setPaused]. The server always renders "not paused"; the browser corrects it right after load. */
export function useSyncPaused(): [boolean, (paused: boolean) => void] {
  const paused = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    try {
      if (next) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: nothing to remember */
    }
    listeners.forEach((l) => l());
  }, []);
  return [paused, set];
}
