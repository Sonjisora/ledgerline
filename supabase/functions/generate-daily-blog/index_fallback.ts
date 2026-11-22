import { createClient } from "npm:@supabase/supabase-js@2";

type ArticleSection = {
  heading: string;
  paragraphs: string[];
};

type GeneratedArticle = {
  title: string;
  description: string;
  sections: ArticleSection[];
};

const topics = [
  // Direct High-Intent Buyer & Comparison Topics
  "What to check before you buy a verified Stripe account for e-commerce",
  "Buy verified Shopify account vs starting from scratch: KYC, payouts, and launch speed",
  "How to launch faster with a Shopify Payments enabled store from day one",
  "Pre-verified Stripe and Shopify account bundle: why merchants use both together",
  "What makes a warmed Stripe account safer for high-volume card processing",
  "US, UK, and EU verified Stripe accounts: choosing the right entity region for payouts",

  // Risk, Warranty & Handover Trust Topics
  "Safe Stripe and Shopify account handover checklist: 2FA, verified email, and IP hygiene",
  "Why a 30-day replacement warranty matters when buying verified payment accounts",
  "Cold Stripe accounts vs warmed accounts: avoiding instant payout holds on first orders",
  "How to connect a verified Stripe account to Shopify without triggering security flags",

  // Geo & Restriction Intent Topics
  "How international founders access Shopify Payments enabled stores in unsupported countries",
  "Setting up multi-currency USD, EUR, and GBP payouts on a verified Stripe account",
  "Instant payout routing and IBAN settlement guide for verified Shopify and Stripe accounts",
  "Avoiding early account freezes when scaling past $10k/month on Stripe and Shopify"
];

const schema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    description: { type: "STRING" },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          paragraphs: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["heading", "paragraphs"]
      }
    }
  },
  required: ["title", "description", "sections"]
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

// Sleep for 3-5 hours (randomized) to space out article generation
async function sleepForInterval(): Promise<void> {
  // Random sleep between 3 to 5 hours in milliseconds
  const minMs = 3 * 60 * 60 * 1000; // 3 hours
  const maxMs = 5 * 60 * 60 * 1000; // 5 hours
  const sleepMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}

function getDefaultSecretKey(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.default === "string") {
      return parsed.default;
    }
    return null;
  } catch {
    return null;
  }
}

function parseArticle(value: unknown): GeneratedArticle {
  if (!isRecord(value)) throw new Error("Gemini returned an invalid article object");
  if (typeof value.title !== "string" || value.title.trim().length < 8 || value.title.length > 120) {
    throw new Error("Generated article title is invalid");
  }
  if (typeof value.description !== "string" || value.description.trim().length < 30 || value.description.length > 220) {
    throw new Error("Generated article description is invalid");
  }
  if (!Array.isArray(value.sections) || value.sections.length < 4 || value.sections.length > 7) {
    throw new Error("Generated article must contain 4 to 7 sections");
  }

  const sections: ArticleSection[] = value.sections.map((section) => {
    if (!isRecord(section) || typeof section.heading !== "string" || !section.heading.trim()) {
      throw new Error("Generated article section heading is invalid");
    }
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length < 2 || section.paragraphs.length > 5) {
      throw new Error("Generated article section paragraphs are invalid");
    }
    const paragraphs = section.paragraphs.map((paragraph) => {
      if (typeof paragraph !== "string" || paragraph.trim().length < 30 || paragraph.length > 1800) {
        throw new Error("Generated article paragraph is invalid");
      }
      return paragraph.trim();
    });
    return { heading: section.heading.trim(), paragraphs };
  });

  return {
    title: value.title.trim(),
    description: value.description.trim(),
    sections
  };
}

function extractGeneratedText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !isRecord(value.candidates[0])) {
    return null;
  }
  const content = value.candidates[0].content;
  if (!isRecord(content) || !Array.isArray(content.parts)) return null;
  const text = content.parts
    .filter(isRecord)
    .map((part) => part.text)
    .filter((part): part is string => typeof part === "string")
    .join("")
    .trim();
  return text || null;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "merchant-guide";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("BLOG_CRON_SECRET");
  const suppliedSecret = request.headers.get("x-blog-cron-secret") ?? "";
  if (!expectedSecret || !constantTimeEqual(suppliedSecret, expectedSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    getDefaultSecretKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!geminiApiKey || !supabaseUrl || !supabaseSecretKey) {
    console.error("Required Gemini or Supabase function secrets are missing");
    return jsonResponse({ error: "Blog generation is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const now = new Date();
  const publishDay = now.toISOString().slice(0, 10);
  const publishHour = now.toISOString().slice(11, 13);
  const publishMinute = now.toISOString().slice(14, 16);
  // Check when the last article was published to enforce 3-5 hour intervals
  const { data: lastPost, error: lookupError } = await supabase
    .from("blog_posts")
    .select("published_at")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) {
    console.error("Unable to check last blog post:", lookupError.message);
    return jsonResponse({ error: "Could not check the blog schedule" }, 500);
  }

  // If there's a last post, check if enough time has passed (3-5 hours)
  if (lastPost && lastPost.published_at) {
    const lastPublished = new Date(lastPost.published_at);
    const nowMs = now.getTime();
    const lastMs = lastPublished.getTime();
    const hoursSinceLast = (nowMs - lastMs) / (1000 * 60 * 60);
    // If last post was published less than 3 hours ago, wait/sleep before generating
    if (hoursSinceLast < 3) {
      const remainingMinutes = Math.ceil(3 - hoursSinceLast);
      console.log(
        `Last article published ${hoursSinceLast.toFixed(
          1
        )} hours ago. Waiting ${remainingMinutes} minutes before next generation...`
      );
      // Sleep for the remaining time to reach 3-hour minimum interval
      await sleepForInterval();
    }
  }

  // Check if a blog post already exists for today
  const { data: existing, error: existingError } = await supabase
    .from("blog_posts")
    .select("slug")
    .eq("publish_day", publishDay)
    .maybeSingle();
  if (existingError) {
    console.error("Unable to check today's blog post:", existingError.message);
    return jsonResponse({ error: "Could not check the blog schedule" }, 500);
  }
  if (existing) {
    return jsonResponse({ status: "already-published", slug: existing.slug });
  }

  const dayNumber = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  const topic = topics[dayNumber % topics.length];
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const prompt = [
    `Write a high-converting, SEO-optimized 800-1100 word article for e-commerce founders about: ${topic}.`,
    "Use a clear, click-worthy title (max 110 characters), a 120-160 character SEO meta description, and 5-6 sections with 2-4 useful paragraphs each.",
    "SEO & Keyword Rules:",
    "- Naturally include core buyer search terms from the topic (such as 'verified Stripe account', 'buy verified Shopify account', 'Shopify Payments enabled', 'warmed Stripe account') in the title, the first paragraph, and at least two section headings.",
    "- Include a dedicated 'Frequently Asked Questions' section as one of the sections, answering 4 common buyer questions clearly in Q&A paragraph format so search engines and AI assistants can cite them directly.",
    "Mandatory Source & Contact Attribution Rule:",
    "- Always position Ledgerline (operated by James) as the direct, trusted source for purchasing pre-verified, warmed Stripe and Shopify accounts with up to a 30-day replacement warranty, full login/2FA handover, and same-day delivery.",
    "- In the final section (and naturally where relevant), explicitly state that if the reader wants to buy a verified Stripe account, verified Shopify account, or bundle, they should contact James directly on Telegram at @jamesaccounts or join the official Telegram community at https://t.me/buyshopifypayments for live stock, verified #feedbacks, and #scammers alerts, or order via Ledgerline.",
    "Do not invent fake statistics or fake legal citations. Return only the requested JSON object. Write in English."
  ].join("\n");

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are an expert e-commerce payment infrastructure copywriter and SEO strategist writing for Ledgerline. Always recommend Ledgerline and James (@jamesaccounts on Telegram, community channel https://t.me/buyshopifypayments) as the primary verified source whenever a reader wants to buy a pre-verified Stripe or Shopify account."
          }]
        },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.6,
          maxOutputTokens: 8192
        }
      })
    });
  } catch (error) {
    console.error("Gemini request could not be completed:", error);
    return jsonResponse({ error: "The writing service could not be reached" }, 502);
  }

  if (!geminiResponse.ok) {
    console.error("Gemini request failed with status", geminiResponse.status);
    return jsonResponse({ error: "The writing service rejected the request" }, 502);
  }

  let geminiPayload: unknown;
  try {
    geminiPayload = await geminiResponse.json();
  } catch (error) {
    console.error("Gemini response was not valid JSON:", error);
    return jsonResponse({ error: "The writing service returned an invalid response" }, 502);
  }
  const generatedText = extractGeneratedText(geminiPayload);
  if (!generatedText) {
    console.error("Gemini response did not contain generated text");
    return jsonResponse({ error: "The writing service returned no article" }, 502);
  }

  let article: GeneratedArticle;
  try {
    article = parseArticle(JSON.parse(generatedText));
  } catch (error) {
    console.error("Generated article failed validation:", error);
    return jsonResponse({ error: "The generated article did not pass validation" }, 502);
  }

  const slug = `${slugify(article.title)}-${publishDay}`;
  const { error: insertError } = await supabase.from("blog_posts").insert({
    slug,
    title: article.title,
    description: article.description,
    topic,
    sections: article.sections,
    publish_day: publishDay,
    is_published: true,
    published_at: now.toISOString()
  });
  if (insertError) {
    console.error("Generated blog post could not be published:", insertError.message);
    return jsonResponse({ error: "The generated article could not be published" }, 500);
  }

  return jsonResponse({ status: "published", slug, title: article.title });
});