"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export interface OnboardingAnswers {
  businessName?: string;
  niche?: string;
  goal?: string;
  /** How they heard about us — one of SOURCES in the wizard. */
  source?: string;
  /** Free text, when they picked "Other". */
  sourceDetail?: string;
}

// Wizard answers live on the auth user's metadata (the same place business_name
// / niche / goal already live) — no migration needed, and still queryable for
// attribution reporting via auth.users.raw_user_meta_data.
function metadataFrom(answers: OnboardingAnswers, existingBusinessName?: string) {
  return {
    business_name: answers.businessName?.trim() || existingBusinessName || "",
    niche: answers.niche ?? null,
    goal: answers.goal ?? null,
    referral_source: answers.source ?? null,
    referral_source_detail: answers.sourceDetail?.trim() || null,
  };
}

// Persist the wizard answers to the user's metadata and flip the `onboarded`
// flag so the dashboard stops routing them back here.
export async function completeOnboarding(answers: OnboardingAnswers) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/?auth=signup");

  await supabase.auth.updateUser({
    data: {
      onboarded: true,
      ...metadataFrom(
        answers,
        user.user_metadata?.business_name as string | undefined,
      ),
    },
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// Skip = mark onboarded (so we don't nag them again) but KEEP whatever they
// already answered — this previously discarded a business name they'd typed.
export async function skipOnboarding(answers: OnboardingAnswers = {}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/?auth=signup");

  await supabase.auth.updateUser({
    data: {
      onboarded: true,
      ...metadataFrom(
        answers,
        user.user_metadata?.business_name as string | undefined,
      ),
    },
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
