import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OrderScreen } from "@/components/order/OrderScreen";
import { loadOrderDetail } from "@/lib/order-detail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-5 pt-6 text-sm text-muted">Loading order…</p>}>
      <OrderContent params={params} />
    </Suspense>
  );
}

async function OrderContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const model = await loadOrderDetail(id);
  if (!model) notFound();
  return <OrderScreen model={model} />;
}
