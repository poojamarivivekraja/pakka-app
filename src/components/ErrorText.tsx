"use client";

import Link from "next/link";
import { PASSCODE_MESSAGE } from "@/lib/passcode-message";

/** An action's error. The passcode refusal becomes a link to the passcode screen that returns to this page. */
export function ErrorText({ message, className }: { message: string; className: string }) {
  if (message !== PASSCODE_MESSAGE) return <span role="alert" className={className}>{message}</span>;
  const here = typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;
  return (
    <span role="alert" className={className}>
      <Link href={`/passcode?next=${encodeURIComponent(here)}`} className="font-semibold text-primary underline">{message}</Link>
    </span>
  );
}
