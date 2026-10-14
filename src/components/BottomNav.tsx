"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Orders", match: (p: string) => p === "/" || p.startsWith("/orders") },
  { href: "/chats", label: "Chats", match: (p: string) => p.startsWith("/chats") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="sticky bottom-0 mt-auto flex border-t border-border bg-surface">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 py-4 text-center text-sm ${active ? "font-bold text-ink" : "font-medium text-muted"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
