import { SessionRedirect } from "@/components/auth/SessionRedirect";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Problem } from "@/components/landing/Problem";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { WhySlideshows } from "@/components/landing/WhySlideshows";
import { Gallery } from "@/components/landing/Gallery";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ } from "@/components/landing/FAQ";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";

// Section order is the conversion path (content/landing-copy.md):
// fold → problem → how → differentiation → proof gallery → pricing → FAQ → close.
export default function Home() {
  return (
    <>
      <SessionRedirect />
      <Header />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <WhySlideshows />
        <Gallery />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
