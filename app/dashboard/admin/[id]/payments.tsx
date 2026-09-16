"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminPayment } from "@/lib/admin/payments";

// The customer's Stripe payments, each with a refund action. A refund is
// irreversible, so the button is two-step: the first click arms it and says
// exactly what will happen, the second fires. Nothing here talks to Stripe
// directly — /api/admin/refund does, behind the admin email check.

function money(cents: number, currency: string): string {
  const base = `$${(cents / 100).toFixed(2)}`;
  return currency.toLowerCase() === "usd" ? base : `${base} ${currency.toUpperCase()}`;
}

function StatusPill({ p, done }: { p: AdminPayment; done: boolean }) {
  const [label, cls] =
    p.refunded || done
      ? ["Refunded", "bg-white/[0.06] text-white/45"]
      : p.amountRefunded > 0
        ? ["Partly refunded", "bg-amber-500/15 text-amber-300"]
        : p.status === "succeeded"
          ? ["Paid", "bg-emerald-500/15 text-emerald-300"]
          : p.status === "pending"
            ? ["Pending", "bg-amber-500/15 text-amber-300"]
            : ["Failed", "bg-red-500/15 text-red-300"];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function PaymentsPanel({
  userId,
  payments,
  error,
  hasCustomer,
}: {
  userId: string;
  payments: AdminPayment[];
  error: string | null;
  hasCustomer: boolean;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});

  async function refund(p: AdminPayment) {
    setBusy(p.chargeId);
    setFailed((f) => ({ ...f, [p.chargeId]: "" }));
    try {
      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, chargeId: p.chargeId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        reversed?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDone((d) => ({ ...d, [p.chargeId]: json.reversed ?? "refunded" }));
      setArmed(null);
      // Credits / plan in the metrics above come from the server — re-render.
      router.refresh();
    } catch (e) {
      setFailed((f) => ({
        ...f,
        [p.chargeId]: e instanceof Error ? e.message : "Refund failed.",
      }));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-sm text-amber-200/70">
        Couldn&apos;t load payments from Stripe: {error}
      </p>
    );
  }
  if (payments.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-white/35">
        {hasCustomer ? "No payments yet." : "Never opened checkout."}
      </p>
    );
  }

  return (
    <>
      {payments.map((p) => {
        const isDone = Boolean(done[p.chargeId]);
        const refundable = p.status === "succeeded" && !p.refunded && !isDone;
        const isArmed = armed === p.chargeId;
        const isBusy = busy === p.chargeId;
        const note = done[p.chargeId] || failed[p.chargeId];
        return (
          <div key={p.chargeId} className="border-b border-white/[0.04] px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white">{p.label}</span>
                <span className="block text-xs text-white/35">
                  {new Date(p.createdAt).toLocaleDateString()} · {money(p.amount, p.currency)}
                  {p.receiptUrl && (
                    <>
                      {" · "}
                      <a
                        href={p.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-white/20 underline-offset-2 hover:text-white"
                      >
                        receipt
                      </a>
                    </>
                  )}
                </span>
              </span>
              <StatusPill p={p} done={isDone} />
              {refundable && !isArmed && (
                <button
                  type="button"
                  onClick={() => setArmed(p.chargeId)}
                  className="text-xs text-white/45 transition-colors hover:text-white"
                >
                  Refund
                </button>
              )}
              {refundable && isArmed && (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => refund(p)}
                    className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {isBusy
                      ? "Refunding…"
                      : `Refund ${money(p.amount, p.currency)}${
                          p.kind === "subscription" ? " & cancel plan" : ""
                        }`}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setArmed(null)}
                    className="text-xs text-white/40 transition-colors hover:text-white"
                  >
                    Keep
                  </button>
                </span>
              )}
            </div>
            {note && (
              <p
                className={`mt-1.5 text-xs ${
                  failed[p.chargeId] ? "text-red-300" : "text-white/40"
                }`}
              >
                {note}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
