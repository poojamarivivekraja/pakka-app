export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`mx-5 mt-4 rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</section>;
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink">{children}</h2>;
}
