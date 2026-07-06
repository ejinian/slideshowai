import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Provisions a fixed, onboarded test user (+ a fake TikTok connection) via the
// service key, then logs in through the real UI so the SSR auth cookies are set
// correctly. The cookies are saved and reused by every other test. No OpenAI.

const authFile = "e2e/.auth/state.json";
const EMAIL = "e2e@slideshowai.test";
const PASSWORD = "e2e-Test-Pass-1234!";

setup("provision test user + authenticate", async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  const admin = createClient(url, secret, { auth: { persistSession: false } });

  const meta = { onboarded: true, business_name: "E2E Test" };

  // Create the user, or reuse + refresh it if it already exists.
  const { data: created } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: meta,
  });
  let userId = created?.user?.id;
  if (!userId) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users.find((u) => u.email === EMAIL)?.id;
    if (userId) {
      await admin.auth.admin.updateUserById(userId, {
        password: PASSWORD,
        email_confirm: true,
        user_metadata: meta,
      });
    }
  }
  if (!userId) throw new Error("Could not provision the E2E test user.");

  // Fake TikTok connection so the Post-to-TikTok modal opens as "connected".
  // (The actual post/status calls are mocked in the spec — this token is never used.)
  await admin.from("tiktok_connections").upsert(
    {
      user_id: userId,
      open_id: "e2e-open-id",
      access_token: "e2e-fake-token",
      refresh_token: "e2e-fake-refresh",
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // Log in through the real form → the app sets the Supabase SSR cookies.
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  await page.context().storageState({ path: authFile });
});
