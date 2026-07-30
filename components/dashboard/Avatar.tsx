"use client";

import { useState } from "react";

const SIZES = {
  xs: "h-8 w-8 text-xs",
  sm: "h-9 w-9 text-sm",
  lg: "h-14 w-14 text-xl",
} as const;

// Account avatar — shows the user's Google profile photo when we have one
// (user_metadata.avatar_url / picture, threaded through the dashboard layout),
// falling back to a gradient monogram for email/password accounts or if the
// image fails to load. Single source of truth for every avatar in the app:
// the sidebar account row, the mobile top bar, and the Settings modal.
export function Avatar({
  src,
  name,
  size = "sm",
  className = "",
}: {
  /** Google photo URL, or null/undefined to render the monogram fallback. */
  src?: string | null;
  /** Display name or email — its first character is the fallback initial. */
  name: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const base = `grid shrink-0 place-items-center overflow-hidden rounded-full ${SIZES[size]} ${className}`;

  if (src && !failed) {
    return (
      <span className={base}>
        {/* Plain <img>, not next/image: Google's photo host rotates, so a
            remotePatterns allow-list would be brittle, and any failure (404,
            CSP, hotlink 403) just flips to the monogram below. no-referrer
            dodges the occasional 403 from googleusercontent. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={`${base} bg-linear-to-br from-accent to-fuchsia-500 font-bold uppercase text-white`}
    >
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}
