import { Suspense } from "react";
import { BottomNav, NavLinks } from "@/components/BottomNav";

// The product UI: a mobile-first column, max about 420px, centred on desktop.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col bg-background">
      <div className="flex flex-1 flex-col pb-6">{children}</div>
      <Suspense fallback={<NavLinks pathname="" />}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
