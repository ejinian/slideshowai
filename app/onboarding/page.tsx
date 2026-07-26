import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string }>;
}) {
  const { debug } = await searchParams;

  // Dev-only preview: with ?debug=1 the wizard renders for ANYONE, signed in
  // or not, so the flow can be iterated on without an account (the landing's
  // "Onboarding (debug)" button links here). Hard-gated to non-production, so
  // on the deployed site this branch never runs and the auth guard below is
  // the only path. Caveat: finish/skip still need a real user — with no
  // session those actions bounce to the signup modal instead of saving.
  const devPreview = debug === "1" && process.env.NODE_ENV !== "production";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Must be signed in, and only run once — already-onboarded users skip it,
  // unless we're in the dev preview above.
  // Auth lives in the landing modals now — the old /signup page is just a
  // redirect stub, so point straight at the modal (its return_to was dropped
  // by that stub anyway; the dashboard guard sends new users back here).
  if (!user && !devPreview) redirect("/?auth=signup");
  if (user?.user_metadata?.onboarded && !devPreview) redirect("/dashboard");

  const businessName =
    (user?.user_metadata?.business_name as string | undefined)?.trim() || "";
  const firstName = (user?.email ?? "").split("@")[0].split(/[.\-_]/)[0];

  return (
    <OnboardingWizard
      initialBusinessName={businessName}
      firstName={firstName ? firstName[0].toUpperCase() + firstName.slice(1) : ""}
    />
  );
}
