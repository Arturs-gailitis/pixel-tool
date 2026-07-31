import assert from "node:assert/strict";
import test from "node:test";
import { generateLevelImage, levelArtPrompt } from "../image-generation.js";

test("pieprasa Cloudflare kontu un API tokenu", async () => {
  const previousAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const previousApiToken = process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  try {
    await assert.rejects(
      generateLevelImage("zila pils"),
      error => error.status === 503 && error.message.includes("CLOUDFLARE_ACCOUNT_ID")
    );
  } finally {
    if (previousAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccountId;
    if (previousApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = previousApiToken;
  }
});

test("nosūta līmenim pielāgotu promptu un atgriež PNG", async () => {
  let request;
  const result = await generateLevelImage("sarkana lapsa mežā", {
    accountId: "account-id",
    apiToken: "test-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: { image: "aW1hZ2U=" } })
      };
    }
  });

  assert.equal(request.url, "https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/@cf/black-forest-labs/flux-1-schnell");
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  const body = JSON.parse(request.options.body);
  assert.equal(body.steps, 4);
  assert.match(body.prompt, /sarkana lapsa mežā/);
  assert.match(body.prompt, /12 by 12 grid/);
  assert.deepEqual(result, {
    mimeType: "image/jpeg",
    dataBase64: "aW1hZ2U=",
    model: "@cf/black-forest-labs/flux-1-schnell",
    revisedPrompt: null
  });
});

test("atgriež saprotamu Cloudflare API kļūdu", async () => {
  await assert.rejects(
    generateLevelImage("pils", {
      accountId: "account-id",
      apiToken: "test-token",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ success: false, errors: [{ message: "Rate limit reached" }] })
      })
    }),
    error => error.status === 429 && error.message === "Rate limit reached"
  );
});

test("paplašinātais prompts aizliedz tekstu un uzsver lielus krāsu laukumus", () => {
  const prompt = levelArtPrompt("kosmosa kuģis");
  assert.match(prompt, /large clean color regions/);
  assert.match(prompt, /no text/);
  assert.match(prompt, /kosmosa kuģis/);
});
