import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConnection } from "@/utils/tiktok";
import {
  publishSlideshowToTikTok,
  PRIVACY_LEVELS,
  type PrivacyLevel,
} from "@/lib/tiktok/publish";
import { mintSessionCookie } from "./session";
import { reviewSlideshow, type AutopilotReview } from "./review";

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
const MAX_COLLECTION_PICK = 60;

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

export interface PlanPatch {
  enabled?: boolean;
  connection_id?: string | null;
  collection_id?: string | null;
  topics?: string[];
  slide_count?: number;
  privacy_level?: PrivacyLevel;
  max_pending?: number;
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

export async function generateItem(
  admin: SupabaseClient,
  plan: AutopilotPlan,
  origin: string,
  /** Reuse a topic (the Regenerate button) instead of taking the next one. */
  topicOverride?: string,
): Promise<AutopilotItem> {
  const topics = plan.topics.map((t) => t.trim()).filter(Boolean);
  const topic = topicOverride?.trim() || topics[plan.next_topic_index % Math.max(1, topics.length)];
  if (!topic) throw new AutopilotError("Add at least one topic to the plan first.");

  const { data: created, error } = await admin
    .from("autopilot_items")
    .insert({ plan_id: plan.id, user_id: plan.user_id, topic, status: "generating", attempts: 1 })
    .select("*")
    .single();
  if (error || !created) throw new AutopilotError(error?.message ?? "Could not create the item.", 500);
  const item = created as AutopilotItem;

  // Advance the pointer now, so a topic that keeps failing can't jam the plan.
  if (!topicOverride && topics.length > 0) {
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
