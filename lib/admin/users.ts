// SERVER-ONLY. The founder view of who our customers actually are.
//
// Every read here uses the SERVICE-ROLE client, which bypasses RLS by design —
// so the ONLY thing standing between this data and any signed-in user is the
// isAdminEmail() check at the top of each page. Never import this from a client
// component, and never add a route that calls it without re-checking the email
// server-side against supabase.auth.getUser().
//
// Deliberately NARROW. The profiles table carries plenty we could show —
// suggest_count, suggest_window_start, image_swaps, stripe ids, the rate-limit
// clock — and none of it answers "who is paying us and are they using it". Left
// out on purpose; adding a column here should require a reason.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, isPlanId, type PlanId } from "@/lib/billing/plans";

export interface AdminUser {
  id: string;
  email: string | null;
  businessName: string | null;
  plan: PlanId;
  /** Stripe's word for the subscription, when there is one. */
  subscriptionStatus: string | null;
  /** Monthly price of their plan, for the MRR roll-up. */
  monthlyValue: number;
  quota: number | null;
  usedThisPeriod: number;
  credits: number;
  /** All-time, not this period — the real measure of whether they use it. */
  slideshowsTotal: number;
  /** Decks that actually reached TikTok. */
  postsTotal: number;
  tiktokConnected: boolean;
  createdAt: string;
  /** Last generation. The most honest "are they still here" signal we store. */
  lastGeneratedAt: string | null;
}

export interface AdminSummary {
  totalUsers: number;
  payingUsers: number;
  mrr: number;
  /** Generated something in the last 7 days. */
  activeLast7: number;
  /** Signed up but never generated — the drop-off that matters most. */
  neverGenerated: number;
  slideshowsTotal: number;
  postsTotal: number;
}

export type SortKey =
  | "created"
  | "slideshows"
  | "plan"
  | "lastActive"
  | "posts";

interface ProfileRow {
  id: string;
  email: string | null;
  business_name: string | null;
  plan: string | null;
  subscription_status: string | null;
  plan_quota: number | null;
  slideshows_used: number | null;
  credits: number | null;
  period_end: string | null;
  last_generated_at: string | null;
  created_at: string;
}

const PLAN_ORDER: Record<PlanId, number> = {
  unlimited: 3,
  scale: 2,
  growth: 1,
  free: 0,
};

/**
 * Every user, with the counts that matter, sorted and paginated.
 *
 * Counts come from two grouped reads rather than a per-user query — at this
 * scale (hundreds) one pass over ids is far cheaper than N round-trips, and it
 * keeps the page a single render with no waterfall.
 */
export async function listUsers(
  admin: SupabaseClient,
  opts: { sort: SortKey; page: number; perPage: number; query?: string },
): Promise<{ users: AdminUser[]; total: number; summary: AdminSummary }> {
  const { data: profileRows } = await admin
    .from("profiles")
    .select(
      "id, email, business_name, plan, subscription_status, plan_quota, slideshows_used, credits, period_end, last_generated_at, created_at",
    );
  const profiles = (profileRows ?? []) as ProfileRow[];

  // id -> count, from one read each. `head:false` because we need the rows to
  // group by user; Supabase has no GROUP BY over PostgREST.
  const [{ data: showRows }, { data: postRows }, { data: connRows }] =
    await Promise.all([
      admin.from("slideshows").select("user_id"),
      admin.from("tiktok_posts").select("user_id"),
      admin.from("tiktok_connections").select("user_id"),
    ]);

  const tally = (rows: { user_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.user_id, (m.get(r.user_id) ?? 0) + 1);
    return m;
  };
  const shows = tally(showRows as { user_id: string }[] | null);
  const posts = tally(postRows as { user_id: string }[] | null);
  const connected = new Set(
    ((connRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  const now = Date.now();
  const users: AdminUser[] = profiles.map((p) => {
    const plan: PlanId = isPlanId(p.plan ?? "") ? (p.plan as PlanId) : "free";
    // A lapsed period means the counter is stale; the generate route resets it
    // lazily, so showing the raw number would overstate usage.
    const periodLive = p.period_end != null && Date.parse(p.period_end) > now;
    return {
      id: p.id,
      email: p.email,
      businessName: p.business_name,
      plan,
      subscriptionStatus: p.subscription_status,
      monthlyValue: plan === "free" ? 0 : PLANS[plan].price,
      quota: p.plan_quota ?? PLANS[plan].quota,
      usedThisPeriod: periodLive ? (p.slideshows_used ?? 0) : 0,
      credits: p.credits ?? 0,
      slideshowsTotal: shows.get(p.id) ?? 0,
      postsTotal: posts.get(p.id) ?? 0,
      tiktokConnected: connected.has(p.id),
      createdAt: p.created_at,
      lastGeneratedAt: p.last_generated_at,
    };
  });

  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const summary: AdminSummary = {
    totalUsers: users.length,
    payingUsers: users.filter((u) => u.plan !== "free").length,
    mrr: users.reduce((sum, u) => sum + u.monthlyValue, 0),
    activeLast7: users.filter(
      (u) => u.lastGeneratedAt != null && Date.parse(u.lastGeneratedAt) > weekAgo,
    ).length,
    neverGenerated: users.filter((u) => u.slideshowsTotal === 0).length,
    slideshowsTotal: users.reduce((s, u) => s + u.slideshowsTotal, 0),
    postsTotal: users.reduce((s, u) => s + u.postsTotal, 0),
  };

  const q = opts.query?.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.email?.toLowerCase().includes(q) ||
          u.businessName?.toLowerCase().includes(q),
      )
    : users;

  const sorted = [...filtered].sort((a, b) => {
    switch (opts.sort) {
      case "slideshows":
        return b.slideshowsTotal - a.slideshowsTotal;
      case "posts":
        return b.postsTotal - a.postsTotal;
      case "plan":
        // Paying first, then by how much they pay, then by usage.
        return (
          PLAN_ORDER[b.plan] - PLAN_ORDER[a.plan] ||
          b.slideshowsTotal - a.slideshowsTotal
        );
      case "lastActive":
        return (
          (b.lastGeneratedAt ? Date.parse(b.lastGeneratedAt) : 0) -
          (a.lastGeneratedAt ? Date.parse(a.lastGeneratedAt) : 0)
        );
      default:
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    }
  });

  const start = (opts.page - 1) * opts.perPage;
  return {
    users: sorted.slice(start, start + opts.perPage),
    total: filtered.length,
    summary,
  };
}

export interface AdminUserDetail extends AdminUser {
  slideshows: {
    id: string;
    title: string | null;
    slideCount: number | null;
    createdAt: string;
    /** Latest TikTok status for this deck, when it was posted. */
    postStatus: string | null;
  }[];
}

/** One user, with their decks newest-first. */
export async function getUser(
  admin: SupabaseClient,
  userId: string,
): Promise<AdminUserDetail | null> {
  const { users } = await listUsers(admin, {
    sort: "created",
    page: 1,
    perPage: Number.MAX_SAFE_INTEGER,
  });
  const base = users.find((u) => u.id === userId);
  if (!base) return null;

  const [{ data: showRows }, { data: postRows }] = await Promise.all([
    admin
      .from("slideshows")
      .select("id, title, slide_count, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("tiktok_posts")
      .select("slideshow_id, status, created_at")
      .eq("user_id", userId),
  ]);

  // Newest post per deck — a deck can be posted more than once.
  const latestPost = new Map<string, string | null>();
  for (const r of (postRows ?? []) as {
    slideshow_id: string;
    status: string | null;
  }[]) {
    if (!latestPost.has(r.slideshow_id)) latestPost.set(r.slideshow_id, r.status);
  }

  return {
    ...base,
    slideshows: (
      (showRows ?? []) as {
        id: string;
        title: string | null;
        slide_count: number | null;
        created_at: string;
      }[]
    ).map((s) => ({
      id: s.id,
      title: s.title,
      slideCount: s.slide_count,
      createdAt: s.created_at,
      postStatus: latestPost.get(s.id) ?? null,
    })),
  };
}
