import { Suspense } from "react";
import { safeNext } from "@/lib/passcode";
import { PasscodeForm } from "./PasscodeForm";

export default function PasscodePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[360px] flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-primary">Pakka</h1>
        <p className="mt-2 text-sm text-muted">
          This is a demo. Enter the passcode to use the simulator and the AI features.
        </p>
      </div>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Form({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <PasscodeForm next={safeNext(next)} />;
}
