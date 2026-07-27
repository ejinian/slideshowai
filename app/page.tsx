import { SessionRedirect } from "@/components/auth/SessionRedirect";
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
export default function Home() {
  return (
    <>
      <SessionRedirect />
      <Header />
      <main>
        <Hero />
        <MeetSection />
        {/* Social proof immediately before price. Renders nothing until
            lib/testimonials.ts has real, linkable quotes in it. */}
        <Community />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
