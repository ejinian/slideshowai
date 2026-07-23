import { redirect } from "next/navigation";

// The standalone signup page is gone (2026-07-22) — auth happens in the landing
// page modals. Old links/bookmarks land on the landing page with the signup
// modal auto-opened (Header reads ?auth=).
export default function SignupPage() {
  redirect("/?auth=signup");
}
