import { AnalyticsView } from "@/components/dashboard/grow/AnalyticsView";

export const metadata = { title: "Analytics — SlideLabsAI" };

export default function AnalyticsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/40">
          How your posted slideshows are performing.
        </p>
      </header>
      <div className="mt-6">
        <AnalyticsView />
      </div>
    </div>
  );
}
