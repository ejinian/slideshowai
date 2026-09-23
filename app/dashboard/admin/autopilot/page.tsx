import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCachedUser } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import {
  isMissingTable,
  listItems,
  loadPlan,
  type AutopilotItem,
  type AutopilotPlan,
} from "@/lib/autopilot/run";
import { relative } from "../ui";
import {
  AutopilotPanel,
  type PanelCollection,
  type PanelConnection,
  type PanelItem,
} from "./panel";

// Autopilot — admin-only, semi-automatic. Same security boundary as the rest
// of admin: the email check IS the gate, and everything below reads with the
// service-role client. The plan is the caller's own (decks are generated AS
// the admin, posted from THEIR connected account).
export const dynamic = "force-dynamic";

export default async function AdminAutopilotPage() {
  const me = await getCachedUser();
  if (!me || !isAdminEmail(me.email)) notFound();
  const admin = createAdminClient();

  let plan: AutopilotPlan | null = null;
  let items: AutopilotItem[] = [];
  let setupError: string | null = null;
  try {
    plan = await loadPlan(admin, me.id);
    if (plan) items = await listItems(admin, plan.id, 30);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setupError = isMissingTable(msg)
      ? "The autopilot tables don't exist yet — run supabase/migrations/20260923120000_autopilot.sql in the Supabase SQL editor, then reload."
      : msg;
  }

  const [{ data: conns }, { data: cols }, { data: colImgs }] = await Promise.all([
    admin.from("tiktok_connections").select("*").eq("user_id", me.id),
    admin.from("collections").select("id, name").eq("user_id", me.id).order("updated_at", { ascending: false }),
    admin.from("collection_images").select("collection_id").eq("user_id", me.id),
  ]);
  const counts = new Map<string, number>();
  for (const r of colImgs ?? []) {
    const cid = r.collection_id as string;
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  const connections: PanelConnection[] = (conns ?? []).map((c) => {
    const openId = String(c.open_id ?? "");
    const label =
      (c.display_name as string | null) ||
      (c.username ? `@${c.username as string}` : `Account …${openId.slice(-4)}`);
    return { id: c.id as string, label, isDefault: c.is_default === true };
  });
  const collections: PanelCollection[] = (cols ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string) || "Untitled collection",
    count: counts.get(c.id as string) ?? 0,
  }));

  // Per deck: its generation run (diagnostics link) and its slide positions
  // (thumbnails through the session-authed render route — the admin owns them).
  const ssIds = items.map((i) => i.slideshow_id).filter((x): x is string => !!x);
  const runBySlideshow = new Map<string, string>();
  const positionsBy = new Map<string, number[]>();
  if (ssIds.length > 0) {
    const [{ data: runs }, { data: sl }] = await Promise.all([
      admin.from("generation_runs").select("id, slideshow_id").in("slideshow_id", ssIds),
      admin.from("slides").select("slideshow_id, position").in("slideshow_id", ssIds).order("position", { ascending: true }),
    ]);
    for (const r of runs ?? []) if (r.slideshow_id) runBySlideshow.set(r.slideshow_id as string, r.id as string);
    for (const s of sl ?? []) {
      const arr = positionsBy.get(s.slideshow_id as string) ?? [];
      arr.push(s.position as number);
      positionsBy.set(s.slideshow_id as string, arr);
    }
  }
  const panelItems: PanelItem[] = items.map((i) => ({
    ...i,
    createdAgo: relative(i.created_at),
    runId: i.slideshow_id ? (runBySlideshow.get(i.slideshow_id) ?? null) : null,
    positions: i.slideshow_id ? (positionsBy.get(i.slideshow_id) ?? []) : [],
  }));

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <Link href="/dashboard/admin" className="text-sm text-white/40 transition-colors hover:text-white">
        ← Customers
      </Link>
      <div className="mt-4">
        <h1 className="font-tiktok text-2xl font-extrabold tracking-tight text-white">Autopilot</h1>
        <p className="mt-1 max-w-xl text-sm text-white/40">
          Admin-only test. It writes decks from your topics and reviews them. Nothing posts until
          you approve it.
        </p>
      </div>
      {setupError ? (
        <p className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {setupError}
        </p>
      ) : (
        <AutopilotPanel plan={plan} items={panelItems} connections={connections} collections={collections} />
      )}
    </div>
  );
}
