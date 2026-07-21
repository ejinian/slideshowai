import { SessionRedirect } from "@/components/auth/SessionRedirect";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { SlideMarquee } from "@/components/landing/SlideMarquee";
import { NicheDemo } from "@/components/landing/NicheDemo";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Benefits } from "@/components/landing/Benefits";
import { FAQ } from "@/components/landing/FAQ";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <SessionRedirect />
      <Header />
      <main>
        <Hero />
        <SlideMarquee />
        <NicheDemo />
        <HowItWorks />
        <Benefits />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
