// Founder/admin accounts. These bypass billing enforcement entirely (monthly
// quota + the per-user generate rate limit) so the team is never blocked by
// "You've reached your plan's slideshow limit" while testing or demoing.
//
// Server-only in practice — checked against the authenticated user's email from
// Supabase (`supabase.auth.getUser()`), never against client-supplied input.

const ADMIN_EMAILS = [
  "ernest.jinian@gmail.com",
  "crusanovsky@gmail.com",
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(
    email.trim().toLowerCase() as (typeof ADMIN_EMAILS)[number],
  );
}
