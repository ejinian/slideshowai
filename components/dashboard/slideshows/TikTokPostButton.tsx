"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export interface TikTokSlide {
  position: number;
  caption: string | null;
  url: string;
}

// Human labels for TikTok's privacy enum. The actual options SHOWN come from
// creator_info per-account (TikTok UX rule: no hardcoded list, no default).
const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Public",
  SELF_ONLY: "Private (only you)",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
};

interface CreatorInfo {
  nickname: string | null;
  username: string | null;
  avatarUrl: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
}

// A connected TikTok account (identity cached at connect time). More than one
// exists only on Scale — the second connect is gated server-side in the OAuth
// callback.
interface Account {
  id: string;
  openId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isDefault: boolean;
}

type PostState = "idle" | "posting" | "polling" | "done" | "error";

// One row per target account when cross-posting. "processing" = TikTok is
// pulling the slides; terminal states are "done" and "failed".
interface PostResult {
  accountId: string;
  label: string;
  publishId?: string;
  postId?: string | null;
  status: "processing" | "done" | "failed";
  error?: string;
}

/** Privacy options every selected account allows — cross-posting can only
 *  offer what is valid on ALL of them (TikTok's per-account creator_info rule). */
function intersectPrivacy(infos: CreatorInfo[]): string[] {
  if (infos.length === 0) return [];
  return infos.reduce<string[]>(
    (acc, i) => acc.filter((o) => i.privacyOptions.includes(o)),
    [...infos[0].privacyOptions],
  );
}

export function TikTokPostButton({
  slideshowId,
  slides,
  isConnected,
  returnTo,
}: {
  slideshowId: string;
  slides: TikTokSlide[];
  isConnected: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(isConnected);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [caption, setCaption] = useState(
    slides.find((s) => s.caption)?.caption ?? "",
  );
  // No default privacy — TikTok requires the user to pick it manually from the
  // options creator_info returns for their account.
  const [privacy, setPrivacy] = useState<string>("");
  const [coverIndex, setCoverIndex] = useState(0);
  // Creator settings per account (fetched on open + on first check). The
  // compliance view below derives from the CHECKED accounts' entries.
  const [infoMap, setInfoMap] = useState<Record<string, CreatorInfo>>({});
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState("");
  // Multi-account: every connected account + which ones this post goes to.
  // More than one checked = cross-posting (one publish per account).
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  // Per-account outcomes while posting/polling (single-post keeps length 1).
  const [results, setResults] = useState<PostResult[]>([]);
  const resultsRef = useRef<PostResult[]>([]);

  // What the compliance UI runs on: the one checked account's live settings,
  // or — cross-posting — the intersection every target allows.
  const checkedInfos = checked
    .map((id) => infoMap[id])
    .filter((i): i is CreatorInfo => !!i);
  const creatorInfo: CreatorInfo | null =
    checked.length === 0
      ? infoMap["default"] ?? null // accounts list failed to load; default account
      : checkedInfos.length !== checked.length
        ? null // some checked account hasn't loaded yet
        : {
            ...checkedInfos[0],
            privacyOptions: intersectPrivacy(checkedInfos),
            commentDisabled: checkedInfos.some((i) => i.commentDisabled),
          };
  // "Allow comments" — off by default (TikTok: no interaction toggle pre-checked).
  const [allowComment, setAllowComment] = useState(false);
  // Commercial-content disclosure — off by default.
  const [commercial, setCommercial] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  // "direct" = publish now (DIRECT_POST); "drafts" = send to TikTok drafts so you
  // pick your own sound in the app (MEDIA_UPLOAD, needs the video.upload scope).
  const [postMode, setPostMode] = useState<"direct" | "drafts">("direct");
  const [autoMusic, setAutoMusic] = useState(true);
  const [state, setState] = useState<PostState>("idle");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Portal the modal to <body> so it escapes any ancestor `transform`/animation
  // containing block (which otherwise traps `position: fixed` inside the card).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Popup-blocked fallback: the callback did a full-page redirect back to this
  // exact slideshow with a flag. Restore the user's spot — reopen the post modal
  // on success, or surface the connect error — then strip the query so a refresh
  // doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktok_connected") === "1") {
      setConnected(true);
      openModal();
    } else if (params.get("tiktok_error")) {
      setConnectError(params.get("tiktok_error") || "Could not connect TikTok.");
    } else {
      return;
    }
    params.delete("tiktok_connected");
    params.delete("tiktok_error");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  function openModal() {
    setState("idle");
    setError("");
    setOpen(true);
    void openAccounts();
  }

  // Load the account list, then the default account's live settings. One
  // account is the overwhelmingly common case and skips straight through.
  // TikTok UX rule: settings re-fetch on every OPEN (the map is cleared) and a
  // fresh privacy choice is forced.
  async function openAccounts() {
    setInfoMap({});
    setPrivacy("");
    setResults([]);
    resultsRef.current = [];
    try {
      const res = await fetch("/api/tiktok/accounts");
      const data = (await res.json()) as { accounts?: Account[] };
      const list = data.accounts ?? [];
      setAccounts(list);
      const chosen = list.find((a) => a.isDefault)?.id ?? list[0]?.id ?? null;
      setChecked(chosen ? [chosen] : []);
      if (chosen) void fetchInfoFor(chosen);
    } catch {
      // The picker is progressive enhancement — creator-info still resolves
      // the default account without it.
      setChecked([]);
      void fetchInfoFor(undefined);
    }
  }

  // Fetch one account's creator settings into the map. Privacy options differ
  // per account, so every account joining the post needs its own entry.
  async function fetchInfoFor(connectionId: string | undefined) {
    setInfoLoading(true);
    setInfoError("");
    try {
      const res = await fetch(
        `/api/tiktok/creator-info${connectionId ? `?connection=${encodeURIComponent(connectionId)}` : ""}`,
      );
      const data = (await res.json()) as CreatorInfo & { error?: string };
      if (!res.ok) {
        setInfoError(data.error ?? "Could not load your TikTok account info.");
        return;
      }
      const info: CreatorInfo = {
        nickname: data.nickname ?? null,
        username: data.username ?? null,
        avatarUrl: data.avatarUrl ?? null,
        privacyOptions: data.privacyOptions ?? [],
        commentDisabled: !!data.commentDisabled,
      };
      setInfoMap((m) => ({ ...m, [connectionId ?? "default"]: info }));
      // If comments are off in ANY selected account's own settings, the toggle
      // must be greyed AND forced off.
      if (info.commentDisabled) setAllowComment(false);
    } catch {
      setInfoError("Network error loading your TikTok account info.");
    } finally {
      setInfoLoading(false);
    }
  }

  // Toggle an account in/out of the post. At least one stays selected, and a
  // change invalidates the privacy choice when it's not offered by all targets.
  function toggleAccount(id: string) {
    setChecked((cur) => {
      const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
      return next.length === 0 ? cur : next;
    });
    if (!infoMap[id]) void fetchInfoFor(id);
    setPrivacy("");
  }

  // Full-page redirect (no popup window). The callback redirects back to
  // `return_to` with ?tiktok_connected=1, which the effect above restores —
  // reopening the post modal on the same slideshow. Deliberately NOT a popup:
  // the extra OS window was jarring; this returns the user to where they were.
  function connectTikTok() {
    if (typeof window === "undefined") return;
    setConnectError("");
    setConnecting(true);
    const dest = returnTo ?? `/dashboard/slideshows/${slideshowId}`;
    window.location.href = `/api/auth/tiktok?return_to=${encodeURIComponent(dest)}`;
  }

  // Poll every in-flight publish together; done when none are processing.
  async function pollAll() {
    const pending = resultsRef.current.filter((r) => r.status === "processing");
    if (pending.length === 0) {
      setState(resultsRef.current.some((r) => r.status === "done") ? "done" : "error");
      return;
    }
    for (const r of pending) {
      try {
        const res = await fetch("/api/tiktok/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publish_id: r.publishId }),
        });
        const data = (await res.json()) as { status?: string; failReason?: string; error?: string };
        if (!res.ok) {
          r.status = "failed";
          r.error = data.error ?? "Status check failed.";
        } else if (data.status === "PUBLISH_COMPLETE" || data.status === "SEND_TO_USER_INBOX") {
          // PUBLISH_COMPLETE = direct post live; SEND_TO_USER_INBOX = in drafts.
          r.status = "done";
        } else if (data.status === "FAILED") {
          r.status = "failed";
          r.error = data.failReason ?? "TikTok failed to process the post.";
        }
      } catch {
        // Transient network hiccup — leave it processing and retry next tick.
      }
    }
    setResults([...resultsRef.current]);

    const still = resultsRef.current.filter((r) => r.status === "processing");
    if (still.length > 0) {
      pollRef.current = setTimeout(() => void pollAll(), 2000);
      return;
    }
    const succeeded = resultsRef.current.filter((r) => r.status === "done");
    if (succeeded.length === 0) {
      setState("error");
      setError(resultsRef.current[0]?.error ?? "TikTok failed to process the post.");
      return;
    }
    setState("done");
    // Single direct post with a saved row → jump straight to it, as before.
    // Cross-posts stay on the done card so every account's outcome is visible.
    if (resultsRef.current.length === 1 && succeeded[0].postId) {
      setTimeout(() => router.push(`/dashboard/posts/${succeeded[0].postId}`), 1400);
    }
  }

  async function handlePost() {
    setState("posting");
    setError("");
    // One publish per checked account, sequentially — TikTok's init rate limit
    // is per account token, so the order is politeness, not necessity.
    const targets: { accountId: string; label: string }[] =
      checked.length > 0
        ? checked.map((id) => {
            const a = accounts.find((x) => x.id === id);
            return {
              accountId: id,
              label: a
                ? a.username
                  ? `@${a.username}`
                  : a.displayName ?? `Account …${a.openId.slice(-4)}`
                : "TikTok account",
            };
          })
        : [{ accountId: "", label: "your TikTok account" }];

    const out: PostResult[] = [];
    for (const t of targets) {
      try {
        const res = await fetch("/api/tiktok/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slideshowId,
            caption,
            privacyLevel: privacy,
            connectionId: t.accountId || undefined,
            coverIndex,
            postMode: postMode === "drafts" ? "MEDIA_UPLOAD" : "DIRECT_POST",
            autoAddMusic: autoMusic,
            disableComment: !allowComment,
            brandOrganic: commercial && brandOrganic,
            brandContent: commercial && brandContent,
          }),
        });
        const data = (await res.json()) as { publish_id?: string; postId?: string; error?: string };
        if (!res.ok || !data.publish_id) {
          out.push({ ...t, status: "failed", error: data.error ?? "Failed to post." });
        } else {
          out.push({
            ...t,
            status: "processing",
            publishId: data.publish_id,
            postId: data.postId ?? null,
          });
        }
      } catch {
        out.push({ ...t, status: "failed", error: "Network error. Please try again." });
      }
    }

    resultsRef.current = out;
    setResults(out);
    if (out.every((r) => r.status === "failed")) {
      setState("error");
      setError(out[0]?.error ?? "Failed to post.");
      return;
    }
    setState("polling");
    void pollAll();
  }

  function handleDone() {
    setOpen(false);
    setState("idle");
    const done = resultsRef.current.filter((r) => r.status === "done");
    if (done.length === 1 && done[0].postId) router.push(`/dashboard/posts/${done[0].postId}`);
    else router.refresh();
  }

  // Disconnects the one CHECKED account (the footer link hides while several
  // are checked — bulk account management lives on the Schedule page). With
  // others remaining, the modal stays open on the promoted default; removing
  // the last one closes it.
  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const target = checked.length === 1 ? checked[0] : null;
      const res = await fetch("/api/auth/tiktok/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target ? { connectionId: target } : {}),
      });
      if (res.ok) {
        const data = (await res.json()) as { remaining?: number };
        if ((data.remaining ?? 0) > 0) {
          void openAccounts();
        } else {
          setConnected(false);
          setOpen(false);
          setState("idle");
        }
      }
    } catch {
      // no-op — keep the modal open so the user can retry
    } finally {
      setDisconnecting(false);
    }
  }

  // Post-readiness gate. Drafts finish inside the TikTok app, so they only need a
  // caption. A DIRECT post must satisfy TikTok's UX rules: creator info loaded, a
  // privacy level explicitly chosen, and — if disclosing commercial content — at
  // least one of Your Brand / Branded Content, and branded content is never private.
  const commercialOk = !commercial || brandOrganic || brandContent;
  const brandedPrivate = commercial && brandContent && privacy === "SELF_ONLY";
  const readyToPost =
    postMode === "drafts"
      ? true
      : !!privacy &&
        !infoLoading &&
        !infoError &&
        !!creatorInfo &&
        commercialOk &&
        !brandedPrivate;

  // --- Not connected ---
  if (!connected) {
    return (
      <div className="inline-flex flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={connectTikTok}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-accent hover:text-accent-text disabled:opacity-60"
        >
          <TikTokIcon />
          {connecting ? "Connecting…" : "Connect TikTok"}
        </button>
        {connectError && (
          <span className="max-w-xs text-xs text-red-400">{connectError}</span>
        )}
      </div>
    );
  }

  // --- Connected ---
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-black/30 transition-all hover:bg-white/90 hover:shadow-xl"
      >
        <TikTokIcon className="text-black" />
        Post to TikTok
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => state !== "posting" && state !== "polling" && setOpen(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            {state === "done" ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <span className="text-4xl">{postMode === "drafts" ? "📥" : "🎉"}</span>
                <p className="text-lg font-bold">
                  {results.length > 1
                    ? postMode === "drafts"
                      ? `Sent to ${results.filter((r) => r.status === "done").length} accounts' drafts!`
                      : `Posted to ${results.filter((r) => r.status === "done").length} of ${results.length} accounts!`
                    : postMode === "drafts"
                      ? "Sent to your TikTok drafts!"
                      : "Congrats — you posted to TikTok!"}
                </p>
                {results.length > 1 ? (
                  <div className="w-full space-y-1.5 text-left">
                    {results.map((r) => (
                      <p
                        key={r.accountId}
                        className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                      >
                        <span className="truncate font-medium">{r.label}</span>
                        <span
                          className={`ml-3 shrink-0 text-xs font-semibold ${
                            r.status === "done" ? "text-emerald-300" : "text-red-300"
                          }`}
                          title={r.error}
                        >
                          {r.status === "done" ? "Posted ✓" : r.error ?? "Failed"}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    {postMode === "drafts"
                      ? "Open the TikTok app to add your sound and post."
                      : "Taking you to your post…"}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleDone}
                  className="mt-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground"
                >
                  {results.length > 1 || postMode === "drafts" ? "Done" : "See your post →"}
                </button>
              </div>
            ) : (
              <>
                {/* Close sits on the LEFT, before the title — TikTok's own
                    convention, and this modal is what a reviewer compares
                    against their app. Was a bare "✕" on the right, which reads
                    at a different weight and baseline to every other control
                    (same reason the Regenerate glyph became an SVG). */}
                <div className="mb-5 flex items-center gap-3">
                  {state !== "posting" && state !== "polling" && (
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="-ml-1 shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-foreground"
                      aria-label="Close"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  <h2 className="text-lg font-bold">Post to TikTok</h2>
                </div>

                {/* Caption */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    Caption
                  </label>
                  <textarea
                    value={caption ?? ""}
                    onChange={(e) => setCaption(e.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="Add a caption…"
                    disabled={state === "posting" || state === "polling"}
                    className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                  />
                  <p className="mt-1 text-right text-[11px] text-muted">
                    {(caption ?? "").length}/4000
                  </p>
                </div>

                {/* How to post */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    How to post
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([["direct", "Post now"], ["drafts", "Send to drafts"]] as const).map(
                      ([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPostMode(m)}
                          disabled={state === "posting" || state === "polling"}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                            postMode === m
                              ? "border-accent bg-accent/10 text-accent-text"
                              : "border-border bg-card text-muted hover:border-accent/50"
                          }`}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                {postMode === "drafts" ? (
                  <div className="mb-5 rounded-lg border border-border bg-card px-3 py-2.5 text-xs leading-relaxed text-muted">
                    We&apos;ll send these slides to your TikTok{" "}
                    <span className="text-foreground">drafts</span>. Open the TikTok app to pick your
                    own sound, cover, caption &amp; privacy — then post.
                  </div>
                ) : (
                  <>
                {/* Which account you're posting to (TikTok UX requirement).
                    With several connected (Scale), this becomes the picker —
                    switching re-fetches creator info, since privacy options
                    are per-account. */}
                {accounts.length > 1 ? (
                  <div className="mb-4 space-y-1.5">
                    <p className="text-xs font-semibold text-muted">
                      Post from
                      <span className="ml-1.5 font-normal">
                        — check several to post to all of them
                      </span>
                    </p>
                    {accounts.map((a) => {
                      const active = checked.includes(a.id);
                      const info = infoMap[a.id];
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => toggleAccount(a.id)}
                          disabled={state === "posting" || state === "polling"}
                          className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                            active
                              ? "border-accent bg-accent/10"
                              : "border-border bg-card hover:border-accent/50"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                              active ? "border-accent bg-accent" : "border-border bg-transparent"
                            }`}
                          >
                            {active ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                            ) : null}
                          </span>
                          {a.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={a.avatarUrl}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs text-muted">
                              @
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {a.displayName ?? `Account …${a.openId.slice(-4)}`}
                            </span>
                            {info?.username || a.username ? (
                              <span className="block truncate text-[11px] text-muted">
                                @{info?.username ?? a.username}
                              </span>
                            ) : null}
                          </span>
                          {active && !info && infoLoading ? (
                            <span className="shrink-0 text-[11px] text-muted">Loading…</span>
                          ) : a.isDefault ? (
                            <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-muted">
                              Default
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
                    {creatorInfo?.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={creatorInfo.avatarUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs text-muted">
                        @
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {infoLoading
                          ? "Loading account…"
                          : creatorInfo?.nickname ?? "Your TikTok account"}
                      </p>
                      {creatorInfo?.username && (
                        <p className="truncate text-[11px] text-muted">
                          @{creatorInfo.username}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {infoError && (
                  <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {infoError}
                  </p>
                )}

                {/* Privacy — options from creator_info, NO default (TikTok rule) */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    Who can see this?
                  </label>
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value)}
                    disabled={
                      state === "posting" ||
                      state === "polling" ||
                      infoLoading ||
                      !creatorInfo
                    }
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                  >
                    <option value="" disabled>
                      Select who can see this…
                    </option>
                    {(creatorInfo?.privacyOptions ?? []).map((o) => (
                      <option key={o} value={o}>
                        {PRIVACY_LABELS[o] ?? o}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Cover slide picker */}
                {slides.length > 1 && (
                  <div className="mb-5">
                    <p className="mb-1.5 text-xs font-semibold text-muted">Cover slide</p>
                    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                      {slides.map((s) => (
                        <button
                          key={s.position}
                          type="button"
                          onClick={() => setCoverIndex(s.position)}
                          disabled={state === "posting" || state === "polling"}
                          className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                            coverIndex === s.position
                              ? "border-accent ring-2 ring-accent/40"
                              : "border-border hover:border-accent/50"
                          }`}
                          style={{ width: 52, height: 92 }}
                        >
                          {s.url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={s.url}
                              alt={`Slide ${s.position + 1}`}
                              className="h-full w-full object-cover"
                            />
                          )}
                          <span className="absolute bottom-0.5 left-0 right-0 text-center text-[9px] font-bold text-white drop-shadow">
                            {s.position + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Allow comments (TikTok UX requirement; off by default, greyed
                    when the creator has comments disabled in their settings) */}
                <label
                  className={`mb-4 flex items-center justify-between gap-3 ${
                    creatorInfo?.commentDisabled ? "opacity-50" : "cursor-pointer"
                  }`}
                >
                  <span>
                    <span className="block text-xs font-semibold text-muted">
                      Allow comments
                    </span>
                    <span className="block text-[11px] text-muted">
                      {creatorInfo?.commentDisabled
                        ? "Turned off in your TikTok settings"
                        : "Let people comment on this post"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={allowComment}
                    onChange={(e) => setAllowComment(e.target.checked)}
                    disabled={
                      !!creatorInfo?.commentDisabled ||
                      state === "posting" ||
                      state === "polling"
                    }
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                </label>

                {/* Sound */}
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-muted">Sound</p>
                    <p className="text-[11px] text-muted">Let TikTok add a recommended track</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoMusic((v) => !v)}
                    disabled={state === "posting" || state === "polling"}
                    aria-pressed={autoMusic}
                    className="shrink-0 disabled:opacity-60"
                  >
                    <span
                      className={`relative block h-5 w-9 rounded-full transition-colors ${
                        autoMusic ? "bg-accent" : "bg-white/15"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          autoMusic ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </div>

                {/* Commercial content disclosure (TikTok UX requirement) */}
                <div className="mb-4">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="block text-xs font-semibold text-muted">
                        Disclose content promotion
                      </span>
                      <span className="block text-[11px] text-muted">
                        Turn on if this promotes a brand, product, or service
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={commercial}
                      onChange={(e) => setCommercial(e.target.checked)}
                      disabled={state === "posting" || state === "polling"}
                      className="h-4 w-4 shrink-0 accent-accent"
                    />
                  </label>
                  {commercial && (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
                      <label className="flex cursor-pointer items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={brandOrganic}
                          onChange={(e) => setBrandOrganic(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                        />
                        <span>
                          <span className="font-semibold">Your brand</span> — promoting
                          yourself or your own business
                        </span>
                      </label>
                      <label
                        className={`flex items-start gap-2 text-xs ${
                          privacy === "SELF_ONLY" ? "opacity-50" : "cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={brandContent}
                          onChange={(e) => setBrandContent(e.target.checked)}
                          disabled={privacy === "SELF_ONLY"}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                        />
                        <span>
                          <span className="font-semibold">Branded content</span> — a paid
                          partnership promoting another brand
                        </span>
                      </label>
                      {(brandOrganic || brandContent) && (
                        <p className="text-[11px] text-muted">
                          {brandContent
                            ? "Your photo will be labeled as \u2018Paid partnership\u2019."
                            : "Your photo will be labeled as \u2018Promotional content\u2019."}
                        </p>
                      )}
                      {privacy === "SELF_ONLY" && (
                        <p className="text-[11px] text-amber-400">
                          Branded content can&apos;t be posted privately — choose a public
                          audience above.
                        </p>
                      )}
                      {!brandOrganic && !brandContent && (
                        <p className="text-[11px] text-red-300">
                          Pick at least one to continue.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Consent declaration (TikTok UX requirement — exact wording) */}
                <p className="mb-2 text-[11px] leading-relaxed text-muted">
                  By posting, you agree to TikTok&apos;s{" "}
                  {commercial && brandContent && (
                    <>
                      <a
                        href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                        target="_blank"
                        rel="noopener"
                        className="text-accent-text hover:underline"
                      >
                        Branded Content Policy
                      </a>
                      {" and "}
                    </>
                  )}
                  <a
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                    target="_blank"
                    rel="noopener"
                    className="text-accent-text hover:underline"
                  >
                    Music Usage Confirmation
                  </a>
                  .
                </p>
                  </>
                )}

                {/* Error */}
                {state === "error" && error && (
                  <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </p>
                )}

                {/* Status while polling — per-account rows when cross-posting */}
                {state === "polling" &&
                  (results.length > 1 ? (
                    <div className="mb-4 space-y-1.5">
                      {results.map((r) => (
                        <p
                          key={r.accountId}
                          className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                        >
                          <span className="truncate font-medium">{r.label}</span>
                          <span
                            className={`ml-3 shrink-0 text-xs font-semibold ${
                              r.status === "done"
                                ? "text-emerald-300"
                                : r.status === "failed"
                                  ? "text-red-300"
                                  : "text-muted"
                            }`}
                          >
                            {r.status === "done"
                              ? "Posted ✓"
                              : r.status === "failed"
                                ? "Failed"
                                : "Processing…"}
                          </span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-4 text-center text-sm text-muted">
                      <span className="mr-2 inline-block animate-spin">⟳</span>
                      TikTok is processing your slides…
                    </p>
                  ))}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  {state === "error" && (
                    <button
                      type="button"
                      onClick={() => setState("idle")}
                      className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-accent"
                    >
                      Try again
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePost()}
                    disabled={state === "posting" || state === "polling" || !readyToPost}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black shadow-lg shadow-black/30 transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {state === "posting" ? (
                      postMode === "drafts" ? "Sending…" : "Posting…"
                    ) : state === "polling" ? (
                      "Processing…"
                    ) : (
                      <>
                        <TikTokIcon className="text-black" />
                        {checked.length > 1
                          ? postMode === "drafts"
                            ? `Send to ${checked.length} accounts`
                            : `Post to ${checked.length} accounts`
                          : postMode === "drafts"
                            ? "Send to drafts"
                            : "Post now"}
                      </>
                    )}
                  </button>
                </div>

                {/* Disconnect + warm-up hint — subtle, footer */}
                {state !== "posting" && state !== "polling" && (
                  <div className="mt-4 border-t border-border pt-3 text-center">
                    <p className="mb-2 text-[11px] text-muted">
                      Posting from a brand-new account?{" "}
                      <a
                        href="/guides/how-to-warm-up-a-new-tiktok-account"
                        target="_blank"
                        rel="noopener"
                        className="font-medium text-accent-text hover:underline"
                      >
                        Warm it up first
                      </a>{" "}
                      — cold accounts get throttled.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={connectTikTok}
                        disabled={connecting}
                        className="text-[11px] text-muted transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        {connecting ? "Connecting…" : "Connect another account"}
                      </button>
                      {checked.length <= 1 ? (
                        <>
                          <span className="text-[11px] text-muted/50">·</span>
                          <button
                            type="button"
                            onClick={() => void handleDisconnect()}
                            disabled={disconnecting}
                            className="text-[11px] text-muted transition-colors hover:text-red-300 disabled:opacity-50"
                          >
                            {disconnecting
                              ? "Disconnecting…"
                              : accounts.length > 1
                                ? "Disconnect this account"
                                : "Disconnect TikTok account"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function TikTokIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.56V6.79a4.85 4.85 0 01-1.07-.1z" />
    </svg>
  );
}
