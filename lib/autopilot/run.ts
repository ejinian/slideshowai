import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConnection } from "@/utils/tiktok";
import {
  publishSlideshowToTikTok,
  PRIVACY_LEVELS,
  type PrivacyLevel,
} from "@/lib/tiktok/publish";
import { mintSessionCookie } from "./session";
import { reviewSlideshow, type AutopilotReview } from "./review";
import { inventTopic } from "./topics";

// Autopilot, semi-automatic (admin-only test feature, 2026-09-23).
//
// A plan per admin: which TikTok account, stock or one collection, a topic
// list, slide count, visibility. Each run takes the next topic and produces
// one ITEM through three steps, each its own short server call so nothing
// has to fit one function's time budget:
//   generate  → POST /api/generate as the plan's owner (see session.ts) —
//               the unchanged pipeline: lean copy, images, judge, persistence,
//               generation_runs. Item: generating → generated.
//   review    → POST /api/slideshows/[id]/description for the post text, then
//               the vision gate over the rendered slides. Item → needs_review.
//   approve   → publishSlideshowToTikTok + a tiktok_posts row, exactly what
//               the scheduled-post cron does. Item → approved.
// Nothing posts without approve. reject / regenerate are the other exits.
//
// FULLY AUTOMATIC (auto_post, 2026-09-23): the cron tick (autoTick) also
// approves — a deck the reviewer rated `post` with score ≥ min_score is posted
// when one is due (posts_per_day spread evenly over 24h), a `hold` deck is
// parked as rejected with the reviewer's reasons and replaced next tick, and
// topics are INVENTED from the plan's brief + example hooks (topics.ts) so the
// list never runs out. Manual and assisted plans are untouched by all of it.

export type ItemStatus =
  | "generating"
  | "generated"
  | "needs_review"
  | "approved"
  | "rejected"
  | "failed";

export interface AutopilotPlan {
  id: string;
  user_id: string;
  enabled: boolean;
  connection_id: string | null;
  collection_id: string | null;
  topics: string[];
  next_topic_index: number;
  slide_count: number;
  privacy_level: PrivacyLevel;
  max_pending: number;
  /** Fully automatic: the cron also approves + posts (see autoTick). */
  auto_post: boolean;
  posts_per_day: number;
  /** Auto-post only decks the reviewer scored at least this. */
  min_score: number;
  /** What the account posts, for whom, in what voice — topics are invented from it. */
  brief: string;
  last_posted_at: string | null;
}

export interface AutopilotItem {
  id: string;
  plan_id: string;
  user_id: string;
  topic: string;
  slideshow_id: string | null;
  description: string | null;
  status: ItemStatus;
  review: AutopilotReview | null;
  attempts: number;
  error: string | null;
  tiktok_post_id: string | null;
  created_at: string;
  updated_at: string;
}

export const MAX_TOPICS = 100;
export const MAX_TOPIC_CHARS = 300;
export const MAX_BRIEF_CHARS = 1500;
/** TikTok allows 5 pending posts per account per 24h — the hard ceiling. */
export const MAX_POSTS_PER_DAY = 5;
const MAX_COLLECTION_PICK = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AutopilotError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AutopilotError";
  }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function toPlan(row: Record<string, unknown>): AutopilotPlan {
  const priv = String(row.privacy_level ?? "SELF_ONLY");
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    enabled: row.enabled === true,
    connection_id: (row.connection_id as string | null) ?? null,
    collection_id: (row.collection_id as string | null) ?? null,
    topics: Array.isArray(row.topics) ? (row.topics as unknown[]).map(String) : [],
    next_topic_index: clampInt(row.next_topic_index, 0, 1_000_000, 0),
    slide_count: clampInt(row.slide_count, 3, 10, 5),
    privacy_level: (PRIVACY_LEVELS as readonly string[]).includes(priv) ? (priv as PrivacyLevel) : "SELF_ONLY",
    max_pending: clampInt(row.max_pending, 1, 10, 2),
    auto_post: row.auto_post === true,
    posts_per_day: clampInt(row.posts_per_day, 1, MAX_POSTS_PER_DAY, 1),
    min_score: clampInt(row.min_score, 1, 10, 7),
    brief: typeof row.brief === "string" ? row.brief : "",
    last_posted_at: (row.last_posted_at as string | null) ?? null,
  };
}

/** The tables ship in migration 20260923120000 — a missing table reads as
 *  "not set up" so the page can say so instead of 500ing. */
export function isMissingTable(message: string | undefined): boolean {
  return /autopilot_(plans|items)|schema cache|does not exist/i.test(message ?? "");
}

export async function loadPlan(admin: SupabaseClient, userId: string): Promise<AutopilotPlan | null> {
  const { data, error } = await admin
    .from("autopilot_plans")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AutopilotError(error.message, 500);
  return data ? toPlan(data as Record<string, unknown>) : null;
}

/** Every plan (or only enabled ones), least recently touched first — the cron's
 *  round-robin order. */
export async function loadPlanRows(
  admin: SupabaseClient,
  opts: { enabledOnly?: boolean } = {},
): Promise<AutopilotPlan[]> {
  let q = admin.from("autopilot_plans").select("*").order("updated_at", { ascending: true });
  if (opts.enabledOnly) q = q.eq("enabled", true);
  const { data, error } = await q;
  if (error) throw new AutopilotError(error.message, 500);
  return (data ?? []).map((r) => toPlan(r as Record<string, unknown>));
}

export interface PlanPatch {
  enabled?: boolean;
  connection_id?: string | null;
  collection_id?: string | null;
  topics?: string[];
  slide_count?: number;
  privacy_level?: PrivacyLevel;
  max_pending?: number;
  auto_post?: boolean;
  posts_per_day?: number;
  min_score?: number;
  brief?: string;
}

export async function savePlan(
  admin: SupabaseClient,
  userId: string,
  patch: PlanPatch,
): Promise<AutopilotPlan> {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) row.enabled = patch.enabled === true;
  if (patch.connection_id !== undefined) row.connection_id = patch.connection_id;
  if (patch.collection_id !== undefined) row.collection_id = patch.collection_id;
  if (patch.topics !== undefined) {
    row.topics = patch.topics
      .map((t) => String(t).trim().slice(0, MAX_TOPIC_CHARS))
      .filter(Boolean)
      .slice(0, MAX_TOPICS);
  }
  if (patch.slide_count !== undefined) row.slide_count = clampInt(patch.slide_count, 3, 10, 5);
  if (patch.privacy_level !== undefined) {
    if (!(PRIVACY_LEVELS as readonly string[]).includes(patch.privacy_level)) {
      throw new AutopilotError("Invalid visibility.");
    }
    row.privacy_level = patch.privacy_level;
  }
  if (patch.max_pending !== undefined) row.max_pending = clampInt(patch.max_pending, 1, 10, 2);
  if (patch.auto_post !== undefined) row.auto_post = patch.auto_post === true;
  if (patch.posts_per_day !== undefined) row.posts_per_day = clampInt(patch.posts_per_day, 1, MAX_POSTS_PER_DAY, 1);
  if (patch.min_score !== undefined) row.min_score = clampInt(patch.min_score, 1, 10, 7);
  if (patch.brief !== undefined) row.brief = String(patch.brief).trim().slice(0, MAX_BRIEF_CHARS);

  const { data, error } = await admin
    .from("autopilot_plans")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw new AutopilotError(error.message, 500);
  return toPlan(data as Record<string, unknown>);
}

export async function listItems(
  admin: SupabaseClient,
  planId: string,
  limit = 30,
): Promise<AutopilotItem[]> {
  const { data, error } = await admin
    .from("autopilot_items")
    .select("*")
    .eq("plan_id", planId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new AutopilotError(error.message, 500);
  return (data ?? []) as AutopilotItem[];
}

export async function getItem(
  admin: SupabaseClient,
  itemId: string,
  userId: string,
): Promise<AutopilotItem | null> {
  const { data, error } = await admin
    .from("autopilot_items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AutopilotError(error.message, 500);
  return (data as AutopilotItem | null) ?? null;
}

async function patchItem(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await admin
    .from("autopilot_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Where to call our own routes. From a request: the browsing origin (works on
 *  localhost and on either production host). From the cron: the app URL. */
export function selfOrigin(request?: Request): string {
  if (request) {
    const u = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? u.host;
    const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
    if (host) return `${proto}://${host}`;
  }
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (!env) throw new AutopilotError("NEXT_PUBLIC_APP_URL is not configured.", 500);
  return env.replace(/\/$/, "");
}

async function collectionImageIds(admin: SupabaseClient, plan: AutopilotPlan): Promise<string[]> {
  if (!plan.collection_id) return [];
  const { data } = await admin
    .from("collection_images")
    .select("id")
    .eq("collection_id", plan.collection_id)
    .eq("user_id", plan.user_id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_COLLECTION_PICK);
  return (data ?? []).map((r) => r.id as string);
}

// ── step 1: generate ────────────────────────────────────────────────────────

/** With a brief, the next topic is INVENTED in the style of the example list
 *  (never a repeat of recent ones); without one, the list is used in order. */
async function chooseTopic(
  admin: SupabaseClient,
  plan: AutopilotPlan,
): Promise<{ topic: string; cycled: boolean }> {
  const topics = plan.topics.map((t) => t.trim()).filter(Boolean);
  if (plan.brief.trim()) {
    const { data } = await admin
      .from("autopilot_items")
      .select("topic")
      .eq("plan_id", plan.id)
      .order("created_at", { ascending: false })
      .limit(25);
    const recent = (data ?? []).map((r) => String(r.topic));
    try {
      return { topic: await inventTopic(plan, recent), cycled: false };
    } catch (e) {
      console.warn("[autopilot] topic planner failed — cycling the list", e instanceof Error ? e.message : e);
    }
  }
  const topic = topics[plan.next_topic_index % Math.max(1, topics.length)];
  if (!topic) throw new AutopilotError("Add a brief or at least one topic to the plan first.");
  return { topic, cycled: true };
}

export async function generateItem(
  admin: SupabaseClient,
  plan: AutopilotPlan,
  origin: string,
  /** Reuse a topic (the Regenerate button) instead of taking the next one. */
  topicOverride?: string,
): Promise<AutopilotItem> {
  const topics = plan.topics.map((t) => t.trim()).filter(Boolean);
  const chosen = topicOverride?.trim()
    ? { topic: topicOverride.trim(), cycled: false }
    : await chooseTopic(admin, plan);
  const topic = chosen.topic;

  const { data: created, error } = await admin
    .from("autopilot_items")
    .insert({ plan_id: plan.id, user_id: plan.user_id, topic, status: "generating", attempts: 1 })
    .select("*")
    .single();
  if (error || !created) throw new AutopilotError(error?.message ?? "Could not create the item.", 500);
  const item = created as AutopilotItem;

  // Advance the pointer now, so a topic that keeps failing can't jam the plan.
  if (chosen.cycled && topics.length > 0) {
    await admin
      .from("autopilot_plans")
      .update({ next_topic_index: (plan.next_topic_index + 1) % topics.length, updated_at: new Date().toISOString() })
      .eq("id", plan.id);
  }

  try {
    const cookie = await mintSessionCookie(admin, plan.user_id);
    const ids = await collectionImageIds(admin, plan);
    const body: Record<string, unknown> = {
      prompt: topic,
      slideCount: plan.slide_count,
      slideshowCount: 1,
      detail: "short",
      backgroundMode: ids.length > 0 ? "single" : "collection",
    };
    if (ids.length > 0) body.collectionImageIds = ids;
    // No `supercharge` flag → the route answers plain JSON at the end instead
    // of the stage stream. The pipeline itself is identical.
    const res = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      slideshows?: { id?: string }[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || `generate failed (${res.status})`);
    const slideshowId = data.slideshows?.[0]?.id;
    if (!slideshowId) throw new Error("generate returned no slideshow.");
    await patchItem(admin, item.id, { slideshow_id: slideshowId, status: "generated", error: null });
    return { ...item, slideshow_id: slideshowId, status: "generated" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchItem(admin, item.id, { status: "failed", error: msg.slice(0, 500) });
    throw new AutopilotError(`Generation failed: ${msg}`, 502);
  }
}

// ── step 2: describe + review ───────────────────────────────────────────────

export async function reviewItem(
  admin: SupabaseClient,
  item: AutopilotItem,
  origin: string,
): Promise<AutopilotItem> {
  if (!item.slideshow_id) throw new AutopilotError("This item has no slideshow to review.");
  try {
    const cookie = await mintSessionCookie(admin, item.user_id);
    let description = item.description ?? "";
    if (!description) {
      const res = await fetch(`${origin}/api/slideshows/${item.slideshow_id}/description`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ rewrite: false }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json().catch(() => ({}))) as { description?: string };
      if (res.ok && data.description) description = data.description;
    }
    if (!description) {
      // Fall back to the hook so a description hiccup never blocks review.
      const { data: first } = await admin
        .from("slides")
        .select("caption")
        .eq("slideshow_id", item.slideshow_id)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      description = (first?.caption as string | null) ?? "";
    }
    const review = await reviewSlideshow(admin, item.slideshow_id, item.topic, description);
    await patchItem(admin, item.id, { description, review, status: "needs_review", error: null });
    return { ...item, description, review, status: "needs_review" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchItem(admin, item.id, { status: "failed", error: msg.slice(0, 500) });
    throw new AutopilotError(`Review failed: ${msg}`, 502);
  }
}

// ── step 3: approve → post ──────────────────────────────────────────────────

export async function approveItem(
  admin: SupabaseClient,
  item: AutopilotItem,
  plan: AutopilotPlan,
): Promise<{ item: AutopilotItem; postId: string | null }> {
  if (item.status !== "needs_review") throw new AutopilotError("Only a deck awaiting review can be approved.");
  if (!item.slideshow_id) throw new AutopilotError("This item has no slideshow.");

  let openId: string | null = null;
  try {
    const conn = await resolveConnection(admin, plan.user_id, plan.connection_id ?? undefined);
    openId = conn.open_id;
  } catch (e) {
    throw new AutopilotError(e instanceof Error ? e.message : "TikTok account not connected.");
  }

  const caption = (item.description ?? "").slice(0, 2200);
  const outcome = await publishSlideshowToTikTok(admin, plan.user_id, {
    slideshowId: item.slideshow_id,
    caption,
    privacyLevel: plan.privacy_level,
    postMode: "DIRECT_POST",
    autoAddMusic: true,
    connectionId: plan.connection_id ?? undefined,
  });
  if (!outcome.ok) {
    await patchItem(admin, item.id, { error: outcome.error.slice(0, 500) });
    throw new AutopilotError(outcome.error, outcome.status >= 400 ? outcome.status : 502);
  }

  // Same record the post modal and the scheduled cron write, so My Posts and
  // the status poller pick it up.
  const postRow = {
    user_id: plan.user_id,
    slideshow_id: item.slideshow_id,
    publish_id: outcome.publishId,
    caption,
    privacy_level: plan.privacy_level,
    cover_index: outcome.coverIndex,
    status: "PROCESSING_DOWNLOAD",
  };
  let postId: string | null = null;
  const ins = await admin.from("tiktok_posts").insert({ ...postRow, open_id: openId }).select("id").single();
  if (ins.error) {
    const again = await admin.from("tiktok_posts").insert(postRow).select("id").single();
    postId = (again.data?.id as string | undefined) ?? null;
  } else {
    postId = (ins.data?.id as string | undefined) ?? null;
  }
  await patchItem(admin, item.id, { status: "approved", tiktok_post_id: postId, error: null });
  return { item: { ...item, status: "approved", tiktok_post_id: postId }, postId };
}

export async function rejectItem(admin: SupabaseClient, item: AutopilotItem): Promise<void> {
  if (item.status === "approved") throw new AutopilotError("This deck was already posted.");
  await patchItem(admin, item.id, { status: "rejected" });
}

// ── fully automatic: one cron tick ──────────────────────────────────────────

export interface TickAction {
  action: "posted" | "reviewed" | "generated" | "generated+reviewed" | "parked";
  item: string;
  detail?: string;
}

function readyToPost(plan: AutopilotPlan, i: AutopilotItem): boolean {
  return (
    i.status === "needs_review" &&
    i.review?.verdict === "post" &&
    (i.review?.score ?? 0) >= plan.min_score
  );
}

/** Posts are spread evenly: 3/day = one every 8h, measured from the last one.
 *  A little slack (90% of the interval) so an hourly tick doesn't drift late. */
export function postingDue(plan: AutopilotPlan, postedLast24h: number, now = Date.now()): boolean {
  if (!plan.auto_post) return false;
  if (postedLast24h >= plan.posts_per_day) return false;
  if (!plan.last_posted_at) return true;
  const interval = DAY_MS / plan.posts_per_day;
  return now - new Date(plan.last_posted_at).getTime() >= interval * 0.9;
}

/** In automatic mode a `hold` verdict (or a low score) is parked as rejected
 *  with the reviewer's reasons, so the human can still see why, and the next
 *  tick generates a replacement. Manual/assisted plans keep it for a person. */
async function settleAuto(admin: SupabaseClient, plan: AutopilotPlan, item: AutopilotItem): Promise<boolean> {
  if (!plan.auto_post || readyToPost(plan, item)) return false;
  const why =
    item.review?.verdict !== "post"
      ? `auto: reviewer said hold — ${item.review?.summary ?? ""}`.trim()
      : `auto: reviewer score ${item.review?.score} is under ${plan.min_score}`;
  await patchItem(admin, item.id, { status: "rejected", error: why.slice(0, 500) });
  return true;
}

async function postIfDue(
  admin: SupabaseClient,
  plan: AutopilotPlan,
  items: AutopilotItem[],
): Promise<TickAction | null> {
  const since = Date.now() - DAY_MS;
  const postedLast24h = items.filter(
    (i) => i.status === "approved" && new Date(i.updated_at).getTime() >= since,
  ).length;
  if (!postingDue(plan, postedLast24h)) return null;
  const ready = items
    .filter((i) => readyToPost(plan, i))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!ready[0]) return null;
  const out = await approveItem(admin, ready[0], plan);
  const now = new Date().toISOString();
  await admin.from("autopilot_plans").update({ last_posted_at: now, updated_at: now }).eq("id", plan.id);
  plan.last_posted_at = now;
  ready[0].status = "approved";
  ready[0].updated_at = now;
  return { action: "posted", item: ready[0].id, detail: out.postId ?? undefined };
}

/**
 * One tick for one plan. Order: post if one is due and ready → review a deck
 * that was generated but never reviewed → else generate one (and review it)
 * when the ready buffer is under max_pending → post again if the new deck made
 * one due. Each step is short enough to survive a 120s function; a step that
 * times out leaves a resumable status behind for the next tick.
 */
export async function autoTick(
  admin: SupabaseClient,
  plan: AutopilotPlan,
  origin: string,
): Promise<TickAction[]> {
  const actions: TickAction[] = [];
  let items = await listItems(admin, plan.id, 60);

  const posted = await postIfDue(admin, plan, items);
  if (posted) actions.push(posted);

  const unreviewed = items.find((i) => i.status === "generated");
  if (unreviewed) {
    const reviewed = await reviewItem(admin, unreviewed, origin);
    const parked = await settleAuto(admin, plan, reviewed);
    actions.push({ action: parked ? "parked" : "reviewed", item: reviewed.id, detail: reviewed.review?.verdict });
  } else {
    const buffer = items.filter((i) =>
      plan.auto_post ? readyToPost(plan, i) : i.status === "needs_review",
    ).length;
    const hasSource = plan.brief.trim().length > 0 || plan.topics.some((t) => t.trim());
    if (buffer < plan.max_pending && hasSource) {
      const generated = await generateItem(admin, plan, origin);
      const reviewed = await reviewItem(admin, generated, origin).catch(() => null);
      if (reviewed) {
        const parked = await settleAuto(admin, plan, reviewed);
        actions.push({
          action: parked ? "parked" : "generated+reviewed",
          item: generated.id,
          detail: reviewed.review?.verdict,
        });
      } else {
        actions.push({ action: "generated", item: generated.id });
      }
    }
  }

  // A deck that just became ready may be the first post of the day.
  if (!posted && actions.length > 0) {
    items = await listItems(admin, plan.id, 60);
    const late = await postIfDue(admin, plan, items);
    if (late) actions.push(late);
  }
  return actions;
}
