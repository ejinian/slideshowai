import { test, expect, type Page } from "@playwright/test";

// Full slideshow-creation flow with ZERO OpenAI + no real TikTok post: /api/generate
// and the TikTok endpoints are network-mocked, so this drives the whole UI cheaply.

const MOCK_TITLE = "4 reasons to automate your morning";
const IMG =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='270'%20height='480'%3E%3Crect%20width='270'%20height='480'%20fill='%2316213e'/%3E%3C/svg%3E";

const MOCK = {
  slideshows: [
    {
      id: "e2e-mock-id",
      title: MOCK_TITLE,
      persisted: true,
      slides: Array.from({ length: 6 }, (_, i) => ({
        position: i,
        caption: i === 0 ? MOCK_TITLE : `Point ${i}`,
        role: i === 0 ? "title" : i === 5 ? "cta" : "reason",
        number: i === 0 || i === 5 ? null : i,
        url: IMG,
        bgUrl: "",
        posX: 0.5,
        posY: 0.82,
        align: "center",
        maxWidth: null,
      })),
    },
  ],
};

// Open a custom dropdown by its exact label, pick the last option, assert close.
// Retries the open so an unhydrated first click (client-heavy page) doesn't flake.
async function cycleDropdown(page: Page, label: string) {
  const panel = page.locator(".animate-dropdown-in");
  await expect(async () => {
    await page.getByText(label, { exact: true }).click();
    await expect(panel).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const opts = panel.getByRole("button");
  await opts.nth((await opts.count()) - 1).click();
  await expect(panel).toBeHidden();
}

test.describe("slideshow creation → post interface (no OpenAI, no real post)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/generate", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK) }),
    );
    await page.route("**/api/tiktok/post", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publish_id: "e2e", postId: null }) }),
    );
    await page.route("**/api/tiktok/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "PUBLISH_COMPLETE" }) }),
    );
  });

  test("exercises every option, generates, and opens the Post-to-TikTok modal", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /what will you post/i })).toBeVisible();

    // Creation-option dropdowns. Niche is no longer a control — the server
    // derives it from the prompt (lib/generate/nicheDetect.ts).
    for (const label of ["Slides", "Layout", "Source"]) {
      await cycleDropdown(page, label);
    }

    // Prompt + generate (mocked → no OpenAI).
    await page.getByLabel("Describe your slideshow idea").fill(MOCK_TITLE);
    await page.getByRole("button", { name: "Generate" }).click();

    // Result renders.
    await expect(page.getByText("Ready to post")).toBeVisible();
    await expect(page.getByRole("heading", { name: MOCK_TITLE })).toBeVisible();
    await expect(page.getByText("6 slides")).toBeVisible();

    // Post-to-TikTok modal (connection is faked in setup → connected state).
    await page.getByRole("button", { name: /post to tiktok/i }).first().click();
    await expect(page.getByText("How to post")).toBeVisible();
    await expect(page.getByRole("button", { name: /send to drafts/i })).toBeVisible();
    await expect(page.getByText("Sound", { exact: true })).toBeVisible();
  });
});
