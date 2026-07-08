"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FilterPill } from "@/components/ui/FilterPill";
import {
  TEMPLATE_GOALS,
  type SlideshowTemplate,
  type TemplateGoal,
} from "@/lib/templates";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

// Same handoff the trend remix uses — the Generator reads this on mount.
const GENERATOR_DRAFT_KEY = "slideshowai_draft";

export type TemplateVM = SlideshowTemplate & { previewUrl: string };

const GOAL_LABEL: Record<TemplateGoal, string> = {
  sell: "Sell",
  educate: "Educate",
  story: "Story",
};

export function TemplatesView({ templates }: { templates: TemplateVM[] }) {
  const [goal, setGoal] = useState<TemplateGoal | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(
    () => templates.filter((t) => goal === "all" || t.goal === goal),
    [templates, goal],
  );
  const open = templates.find((t) => t.id === openId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {TEMPLATE_GOALS.map((g) => (
          <FilterPill
            key={g.value}
            label={g.label}
            active={goal === g.value}
            onClick={() => setGoal(g.value)}
          />
        ))}
      </div>

      <div className={`mt-6 ${GRID}`}>
        {visible.map((t) => (
          <TemplateCard key={t.id} template={t} onOpen={() => setOpenId(t.id)} />
        ))}
      </div>

      <TemplateDetail
        key={openId ?? "closed"}
        template={open}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function TemplateCard({
  template,
  onOpen,
}: {
  template: TemplateVM;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className="group block text-left">
      <div className="relative aspect-9/16 overflow-hidden rounded-2xl ring-1 ring-white/10 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-accent/15 group-hover:ring-accent/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={template.previewUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/90 via-black/40 to-transparent" />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white/80 backdrop-blur-sm">
          {GOAL_LABEL[template.goal]}
        </span>
        <div className="absolute inset-x-3 bottom-3">
          <p className="text-center text-sm font-extrabold leading-snug text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
            {template.exampleHook}
          </p>
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-white">
        {template.name}
      </p>
      <p className="mt-0.5 line-clamp-1 text-xs text-white/40">
        {template.slideCount} slides · {template.hookType}
      </p>
    </button>
  );
}

function TemplateDetail({
  template,
  onClose,
}: {
  template: TemplateVM | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "applying" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const apply = async () => {
    if (!template || state === "applying") return;
    setState("applying");
    setErrorMsg("");
    try {
      const res = await fetch("/api/templates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id }),
      });
      const data = (await res.json()) as {
        prompt?: string;
        slides?: string;
        niche?: string;
        layout?: string;
        error?: string;
      };
      if (!res.ok || !data.prompt) {
        throw new Error(data.error || "Personalization failed — try again.");
      }
      localStorage.setItem(
        GENERATOR_DRAFT_KEY,
        JSON.stringify({
          prompt: data.prompt,
          niche: data.niche,
          slides: data.slides,
          layout: data.layout,
        }),
      );
      router.push("/dashboard");
    } catch (e) {
      setState("error");
      setErrorMsg(
        e instanceof Error ? e.message : "Personalization failed — try again.",
      );
    }
  };

  return (
    <Modal open={!!template} onClose={onClose} title={template?.name} width="max-w-xl">
      {template && (
        <div className="sm:flex sm:gap-5">
          <div className="relative mx-auto aspect-9/16 w-40 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={template.previewUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/90 via-black/40 to-transparent" />
            <p className="absolute inset-x-2 bottom-3 text-center text-[13px] font-extrabold leading-snug text-white">
              {template.exampleHook}
            </p>
          </div>

          <div className="mt-4 min-w-0 flex-1 sm:mt-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {template.hookType}
              </span>
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {GOAL_LABEL[template.goal]}
              </span>
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {template.slideCount} slides
              </span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-white/70">
              {template.description}
            </p>

            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/35">
                Format anatomy
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {template.anatomy.map((b) => (
                  <div key={b.slides} className="flex items-center gap-2.5">
                    <span className="w-11 shrink-0 rounded-md bg-white/[0.06] py-0.5 text-center text-[11px] font-semibold text-white/60">
                      {b.slides}
                    </span>
                    <span className="min-w-0 text-[13px] leading-snug text-white/70">
                      {b.beat}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={state === "applying"}
                className="w-full rounded-full bg-accent px-5 py-3 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              >
                {state === "applying"
                  ? "Writing your version…"
                  : "Use this template"}
              </button>
            </div>
            {state === "error" && (
              <p className="mt-2 text-xs text-red-400/80">{errorMsg}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
