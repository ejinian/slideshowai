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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Must be signed in, and only run once — already-onboarded users skip it,
  // unless ?debug=1 is passed (used by the dev-only "View onboarding" button).
  if (!user) redirect("/signup?return_to=/onboarding");
  if (user.user_metadata?.onboarded && debug !== "1") redirect("/dashboard");

  const businessName =
    (user.user_metadata?.business_name as string | undefined)?.trim() || "";
  const firstName = (user.email ?? "").split("@")[0].split(/[.\-_]/)[0];

  return (
    <OnboardingWizard
      initialBusinessName={businessName}
      firstName={firstName ? firstName[0].toUpperCase() + firstName.slice(1) : ""}
    />
  );
}
