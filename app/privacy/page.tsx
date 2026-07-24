export const metadata = {
  title: "Privacy Policy — SlideLabs AI",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-10 text-sm text-muted">Last updated: July 7, 2026</p>

      <section className="space-y-6 text-sm leading-relaxed text-foreground/80">
        <p>
          At SlideLabsAI, we are committed to protecting your privacy and
          ensuring the security of your personal information. This Privacy
          Policy outlines how we collect, use, and safeguard your data when you
          use our web application.
        </p>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">1. Information We Collect</h2>
          <p>We collect the minimum personal information necessary to provide our services:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Email address</li>
            <li>User ID (provided by Google when you sign in with Google)</li>
            <li>Optional onboarding details you choose to share (business name, niche, goal)</li>
            <li>Content you create through the Service (slideshow titles, captions, images, prompts)</li>
            <li>TikTok OAuth credentials (open_id, access token, refresh token) when you connect your TikTok account</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">2. How We Use Your Information</h2>
          <p>Your information is used solely for the purpose of providing our service:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>To tie the slideshows you create to your account</li>
            <li>To generate slideshow content you request (your prompt and niche are sent to OpenAI to write captions)</li>
            <li>To publish slideshows to TikTok on your behalf — only when you explicitly request it</li>
            <li>To personalize the app (for example, pre-selecting your niche in Trends)</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">3. Google Authentication</h2>
          <p>
            SlideLabsAI offers sign-in with Google. When you sign in with
            Google, we receive only your email address and Google user ID for
            account creation and authentication; we do not access any other
            Google account data. Your use of Google sign-in is subject to
            Google&apos;s Privacy Policy.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">4. TikTok Integration</h2>
          <p>
            When you grant us permission to access your TikTok account, we only
            use this access to publish photo slideshows on your behalf. We do
            not:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Like, comment, follow, or view content on your behalf</li>
            <li>Edit or delete your existing posts</li>
            <li>Publish anything without your explicit action</li>
            <li>Access your messages, followers, or other account data beyond what is required to post</li>
          </ul>
          <p className="mt-2">
            When publishing, SlideLabsAI sets the following properties with
            your permission: the post caption, privacy status, cover image, and
            whether TikTok may add music. We store your TikTok access and
            refresh tokens securely, server-side only, for as long as your
            account remains connected. By using the TikTok integration you
            agree to be bound by TikTok&apos;s Terms of Service.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">5. Revoking Access and Data Deletion</h2>
          <p>
            You can disconnect TikTok at any time from within the app, which
            revokes the token with TikTok and deletes your stored credentials
            from our system. You can also revoke SlideLabsAI&apos;s access from
            your TikTok app settings (Settings &amp; privacy → Security →
            Manage app permissions). If you request deletion of your account,
            we will promptly delete your email, tokens, and associated content.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">6. Third-Party Services</h2>
          <p>We rely on a small set of processors to operate the Service:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Supabase — authentication, database, and image storage (with row-level security)</li>
            <li>Vercel — application hosting</li>
            <li>OpenAI — caption and content generation (receives your prompts, never your credentials)</li>
            <li>TikTok — content publishing, only for accounts you connect</li>
          </ul>
          <p className="mt-2">
            We do not sell, share, or disclose your personal information to any
            other third parties. Trend data shown in the app is compiled from
            publicly available TikTok content and contains no data about you.
            Background photos are licensed from Pexels and involve no user
            data.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">7. Data Storage and Security</h2>
          <p>
            Your data is stored securely with Supabase using row-level
            security, so your slideshows and images are accessible only to you.
            TikTok credentials are stored server-side and never exposed to the
            browser. Your data will not be transferred outside our systems
            except as described in this policy or if you request deletion.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">8. Cookies and Tracking</h2>
          <p>
            We use cookies only for session authentication (Supabase auth
            cookies) and short-lived OAuth state verification (TikTok CSRF
            protection). We do not use advertising cookies, third-party
            trackers, or analytics tools that profile you. If we introduce
            product analytics in the future, this policy will be updated first.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">9. Payments</h2>
          <p>
            SlideLabsAI does not currently process payments. If paid plans are
            introduced, payments will be handled by a dedicated payment
            processor and we will never store your card details; this policy
            will be updated before any payment feature launches.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">10. Your Rights</h2>
          <p>
            You have the right to access, correct, or delete your personal data
            at any time, including the right to request deletion of your email
            and all slideshows created with the Service. Depending on where you
            live, you may have additional rights under laws such as the GDPR or
            CCPA. To exercise any of these rights, contact us using the
            information below.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">11. Data Retention</h2>
          <p>
            We retain your data for as long as your account is active.
            Unsaved draft slideshows are cleaned up automatically. When you
            delete your account or request deletion, associated data is
            removed from our systems.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">12. Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. We will notify
            you of any changes by posting the new privacy policy on this page
            and updating the date above.
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-foreground">13. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or want to
            exercise your data rights, contact us at slideshowai@gmail.com.
          </p>
        </div>
      </section>
    </main>
  );
}
