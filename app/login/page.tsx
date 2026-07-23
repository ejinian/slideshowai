import { redirect } from "next/navigation";

// The standalone login page is gone (2026-07-22) — auth happens in the landing
// page modals. Old links/bookmarks land on the landing page with the login
// modal auto-opened (Header reads ?auth=).
export default function LoginPage() {
  redirect("/?auth=login");
}
