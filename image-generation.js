const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const CLOUDFLARE_AI_BASE = "https://api.cloudflare.com/client/v4/accounts";

export async function generateLevelImage(prompt, options = {}) {
  const userPrompt = String(prompt || "").trim();
  if (!userPrompt) throw apiError(400, "Ievadi attēla aprakstu.");
  if (userPrompt.length > 2000) throw apiError(400, "Prompts nedrīkst pārsniegt 2000 rakstzīmes.");

  const accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw apiError(
      503,
      "CLOUDFLARE_ACCOUNT_ID vai CLOUDFLARE_API_TOKEN nav konfigurēts. Pievieno abus servera vides mainīgajos un restartē serveri."
    );
  }

  const model = options.model || process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${CLOUDFLARE_AI_BASE}/${encodeURIComponent(accountId)}/ai/run/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: levelArtPrompt(userPrompt),
      steps: 4
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const message = cloudflareErrorMessage(payload) || `Cloudflare attēla ģenerēšana neizdevās (${response.status}).`;
    throw apiError(response.status >= 400 && response.status < 500 ? response.status : 502, message);
  }

  const dataBase64 = payload?.result?.image;
  if (!dataBase64) throw apiError(502, "Cloudflare atbildē nav ģenerētā attēla.");
  return {
    mimeType: "image/jpeg",
    dataBase64,
    model,
    revisedPrompt: null
  };
}

function cloudflareErrorMessage(payload) {
  if (typeof payload?.errors?.[0]?.message === "string") return payload.errors[0].message;
  if (typeof payload?.messages?.[0]?.message === "string") return payload.messages[0].message;
  return null;
}

export function levelArtPrompt(userPrompt) {
  return [
    userPrompt,
    "",
    "Create this as a square game-level reference image suitable for conversion into a 12 by 12 grid.",
    "Use a clear centered composition, strong readable silhouette, large clean color regions,",
    "4 to 10 visually distinct colors, high contrast, no text, no letters, no numbers, and no watermark.",
    "Keep important details thick enough to remain recognizable after heavy pixel-grid reduction."
  ].join("\n");
}

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
