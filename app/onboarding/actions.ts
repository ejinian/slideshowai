"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export interface OnboardingAnswers {
  businessName?: string;
  niche?: string;
  goal?: string;
}

// Persist the wizard answers to the user's metadata and flip the `onboarded`
// flag so the dashboard stops routing them back here.
export async function completeOnboarding(answers: OnboardingAnswers) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signup");

  await supabase.auth.updateUser({
    data: {
      onboarded: true,
      business_name:
        answers.businessName?.trim() ||
        (user.user_metadata?.business_name as string | undefined) ||
        "",
      niche: answers.niche ?? null,
      goal: answers.goal ?? null,
    },
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// Skip = still mark onboarded (so we don't nag them again), but save nothing.
export async function skipOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signup");

  await supabase.auth.updateUser({ data: { onboarded: true } });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
