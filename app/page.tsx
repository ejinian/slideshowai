import { SessionRedirect } from "@/components/auth/SessionRedirect";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Gallery } from "@/components/landing/Gallery";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { WhySlideshows } from "@/components/landing/WhySlideshows";
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
        <Gallery />
        <HowItWorks />
        <WhySlideshows />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
