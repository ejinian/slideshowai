import { ScheduleView } from "@/components/dashboard/grow/ScheduleView";

export const metadata = { title: "Schedule — SlideShowAI" };

export default function SchedulePage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Schedule</h1>
        <p className="mt-1 text-sm text-white/40">
          Queue your slideshows and let the week post itself.
        </p>
      </header>
      <div className="mt-6">
        <ScheduleView />
      </div>
    </div>
  );
}
