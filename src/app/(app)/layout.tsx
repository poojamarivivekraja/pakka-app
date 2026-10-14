// The product UI: a mobile-first column, max about 420px, centred on desktop.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col bg-background">
      {children}
    </div>
  );
}
