import OpenAI from "openai";
import type { AutopilotPlan } from "./run";

// Invents the next topic for an automatic plan. The admin gives a BRIEF (what
// the account posts, for whom, in what voice) and optional example hooks; each
// tick asks for ONE new line the creator would have typed into the generator —
// same register and subject as the examples, never a repeat of what already
// ran. The generator then does everything else exactly as for a typed topic.
// One small gpt-4.1 call (~0.1¢); on any failure the caller falls back to
// cycling the example list, so a planner hiccup never stalls the plan.

const TOPIC_MODEL = process.env.AUTOPILOT_TOPIC_MODEL || "gpt-4.1";

const SYSTEM =
  "You plan TikTok photo slideshows for ONE account. You get the account's brief (what it " +
  "posts, for whom, in what voice), example hooks or topics the owner likes, and the topics " +
  "already used recently. Return ONE new topic line, written the way the owner would type it " +
  "into a generator: a specific promise or angle inside the brief, in the same register and " +
  "shape as the examples (a countable list, a how-i, a mistakes set, a plain title of the " +
  "payload…), not a category. Plain lowercase, under 110 characters, no emoji, no hashtags, no " +
  "quotes. It must not repeat or lightly reword any recent topic or example — a different " +
  "angle each time, rotating across the shapes the examples show.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic"],
  properties: { topic: { type: "string" } },
} as const;

export async function inventTopic(plan: AutopilotPlan, recent: string[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const openai = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  const examples = plan.topics.map((t) => t.trim()).filter(Boolean);
  const res = await openai.chat.completions.create({
    model: TOPIC_MODEL,
    temperature: 0.9,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `BRIEF: ${plan.brief.trim()}\n\n` +
          (examples.length ? `EXAMPLE HOOKS / TOPICS:\n${examples.map((e) => `- ${e}`).join("\n")}\n\n` : "") +
          (recent.length ? `RECENTLY USED (do not repeat):\n${recent.map((r) => `- ${r}`).join("\n")}\n\n` : "") +
          `Return one new topic.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "autopilot_topic", strict: true, schema: SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { topic?: string };
  const topic = (parsed.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!topic) throw new Error("planner returned no topic");
  return topic;
}
