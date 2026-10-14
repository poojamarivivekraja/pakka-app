import { Card, CardTitle } from "./Card";
import type { HistoryEntry } from "@/lib/order-detail-model";

export function HistoryCard({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) return null;
  return (
    <Card>
      <CardTitle>History</CardTitle>
      <ul className="flex flex-col">
        {history.map((h) => (
          <li key={h.id} className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
            <p className="text-xs text-muted">{h.at}</p>
            <p className="mt-0.5 text-[14px] text-ink">{h.text}</p>
            <p className="text-xs text-muted">{h.source}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
