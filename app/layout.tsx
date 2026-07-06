import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Caption font for the slide editor overlay — matches the Montserrat TTFs the
// server compositor bakes with (lib/generate/fonts.ts), so the editor is WYSIWYG.
const montserrat = localFont({
  variable: "--font-montserrat",
  src: [
    { path: "../assets/fonts/Montserrat-700.ttf", weight: "700", style: "normal" },
    { path: "../assets/fonts/Montserrat-800.ttf", weight: "800", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "SlideShow AI — Ready-to-post TikTok slideshows for your business",
  description:
    "Auto-generate scroll-stopping TikTok Photo Mode slideshows to promote your products. Pick your niche, let AI write the captions, and download post-ready 9:16 slides in seconds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
