import { SessionRedirect } from "@/components/auth/SessionRedirect";
import { AuthTransition } from "@/components/auth/AuthTransition";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { MeetSection } from "@/components/landing/MeetSection";
import { Community } from "@/components/landing/Community";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ } from "@/components/landing/FAQ";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";

// Lovable-style structure (2026-07-22): full-height hero (headline + the
// composer typing to itself) → community-style showcase → the argument
// (how / why / pricing / FAQ) → close.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // ?preview=wall pads the community wall with labelled placeholders on a real
  // deploy — for showing the layout to someone before the quotes exist. Normal
  // visitors never see them.
  const sp = await searchParams;
  const previewWall = sp.preview === "wall";

  // Landing on "/" carrying an OAuth code means Supabase fell back to the Site
  // URL instead of /auth/callback, so the session gets exchanged here on the
  // client and we forward on. Rendering the landing page during that wait is
  // what produced the "flash of landing, then dashboard" — so when the code is
  // present we render ONLY the transition screen. Decided on the SERVER, from
  // the query string, so the landing never reaches the browser at all; doing it
  // client-side would still flash for one paint.
  if (typeof sp.code === "string" && sp.code) {
    return (
      <>
        <SessionRedirect />
        <AuthTransition />
      </>
    );
  }

  return (
    <>
      <SessionRedirect />
      <Header />
      <main>
        <Hero />
        <MeetSection />
        {/* Social proof immediately before price. Renders nothing until
            lib/testimonials.ts has real, linkable quotes in it. */}
        <Community preview={previewWall} />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
