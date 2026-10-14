const swatches = [
  ["bg-background border border-border", "background"],
  ["bg-surface border border-border", "surface"],
  ["bg-dateblock", "date block"],
  ["bg-primary", "primary"],
  ["bg-confirmed-bg text-confirmed-fg", "Confirmed"],
  ["bg-updated-bg text-updated-fg", "Updated from chat"],
  ["bg-review-bg text-review-fg", "Needs review"],
  ["bg-ready-bg text-ready-fg", "Ready to confirm"],
];

// Placeholder until the Orders screen is built.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-5">
      <h1 className="text-2xl font-semibold text-primary">Pakka</h1>
      <p className="text-sm text-muted">Setup check: theme and font.</p>
      <div className="grid grid-cols-2 gap-2">
        {swatches.map(([cls, label]) => (
          <div key={label} className={`rounded-lg px-3 py-4 text-xs ${cls}`}>
            {label}
          </div>
        ))}
      </div>
    </main>
  );
}
