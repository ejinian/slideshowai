import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Caption font for the slide editor overlay — matches the TikTok Sans TTFs the
// server compositor bakes with (lib/generate/fonts.ts), so the editor is WYSIWYG.
const tiktokSans = localFont({
  variable: "--font-caption",
  src: [
    { path: "../assets/fonts/TikTokSans-700.ttf", weight: "700", style: "normal" },
    { path: "../assets/fonts/TikTokSans-800.ttf", weight: "800", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "SlideShow AI — Go viral on TikTok without filming a single video",
  description:
    "Turn your photos into TikTok Photo Mode slideshows that sell without looking like ads. No avatars, no filming, no editing — post straight to TikTok. Free plan, no credit card.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${tiktokSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
