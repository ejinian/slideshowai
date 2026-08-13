import type { PlanId } from "@/lib/billing/plans";
import type { SortKey } from "@/lib/admin/users";

// Shared bits for the two admin pages. Server components — no interactivity
// beyond links, which is what keeps this whole surface a single render.

export const PER_PAGE = 25;

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "created", label: "Newest" },
  { key: "plan", label: "Paying" },
  { key: "slideshows", label: "Most decks" },
  { key: "posts", label: "Most posted" },
  { key: "lastActive", label: "Last active" },
];

const PLAN_STYLE: Record<PlanId, string> = {
  unlimited: "bg-emerald-500/15 text-emerald-300",
  scale: "bg-indigo-500/15 text-indigo-300",
  growth: "bg-sky-500/15 text-sky-300",
  free: "bg-white/[0.06] text-white/45",
};

export function PlanBadge({
  plan,
  status,
}: {
  plan: PlanId;
  status: string | null;
}) {
  // A paid plan whose Stripe subscription is not active is the single most
  // important anomaly on this page — a failed payment still shows the tier.
  const lapsed =
    plan !== "free" && status != null && status !== "active" && status !== "trialing";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${PLAN_STYLE[plan]}`}
      >
        {plan}
      </span>
      {lapsed && (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
          {status}
        </span>
      )}
    </span>
  );
}

export function Metric({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-4 py-3">
      <div
        className={`font-tiktok text-xl font-extrabold tracking-tight ${
          accent ? "text-emerald-300" : muted ? "text-white/40" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-white/35">{label}</div>
    </div>
  );
}

/** "3d ago" — precise enough to judge activity, short enough for a table cell. */
export function relative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** One line of the cost breakdown. */
export function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="truncate text-white/45">{label}</span>
      <span className="shrink-0 tabular-nums text-white/80">
        ${value.toFixed(2)}
      </span>
    </span>
  );
}
