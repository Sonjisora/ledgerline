import type { Config } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { timingSafeEqual, createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { articles, type ArticleSection } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// AI provider settings — change the models here if you want.
// The provider is picked automatically from the API keys you set in Netlify:
//   GROQ_API_KEY   -> Groq (tried first)
//   GEMINI_API_KEY -> Google Gemini (used if Groq isn't set, or as a fallback)
// ---------------------------------------------------------------------------
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT =
  "You write clear, practical, original blog articles for Ledgerline, a site serving online business owners. " +
  "Write in plain English with concrete, useful advice. Do not invent statistics, quotes, or legal guarantees. " +
  "Plain text only in paragraphs (no markdown). " +
  'Respond ONLY with a JSON object of the form {"title": string (max 110 characters), ' +
  '"description": string (120-160 character summary), ' +
  '"sections": [{"heading": string, "paragraphs": [string, ...]}]} with 4-6 sections of 2-4 paragraphs each.';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function passwordMatches(given: string) {
  const expected = process.env.BLOG_ADMIN_PASSWORD || "";
  if (!expected || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function slugify(text: string) {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `${base || "article"}-${Date.now().toString(36)}`;
}

type Generated = { title: string; description: string; sections: ArticleSection[] };

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function validate(value: any): Generated {
  if (!value || typeof value.title !== "string" || typeof value.description !== "string" || !Array.isArray(value.sections)) {
    throw new Error("The model returned an article in an unexpected format.");
  }
  const sections = value.sections
    .filter((s: any) => s && typeof s.heading === "string" && Array.isArray(s.paragraphs))
    .map((s: any) => ({
      heading: s.heading.trim(),
      paragraphs: s.paragraphs.filter((p: any) => typeof p === "string" && p.trim()).map((p: string) => p.trim()),
    }))
    .filter((s: ArticleSection) => s.heading && s.paragraphs.length);
  if (sections.length < 2) throw new Error("The generated article was too short. Please try again.");
  return { title: value.title.trim(), description: value.description.trim(), sections };
}

function userPrompt(title: string, excerpt: string) {
  return `Write a blog article.\n\nWorking title: ${title}\n\nWhat it should cover:\n${excerpt}`;
}

async function generateWithGroq(apiKey: string, title: string, excerpt: string): Promise<Generated> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(title, excerpt) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Groq returned no content.");
  return validate(parseJson(content));
}

async function generateWithGemini(apiKey: string, title: string, excerpt: string): Promise<Generated> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(title, excerpt) }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
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
                  paragraphs: { type: "ARRAY", items: { type: "STRING" } },
                },
                required: ["heading", "paragraphs"],
              },
            },
          },
          required: ["title", "description", "sections"],
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
  if (!text) throw new Error("Gemini returned no content.");
  return validate(parseJson(text));
}

function providers() {
  const list: { name: string; run: (title: string, excerpt: string) => Promise<Generated> }[] = [];
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) list.push({ name: "groq", run: (t, e) => generateWithGroq(groqKey, t, e) });
  // Only use Gemini with your own Google AI Studio key (not a Netlify AI Gateway key).
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && !process.env.GOOGLE_GEMINI_BASE_URL) {
    list.push({ name: "gemini", run: (t, e) => generateWithGemini(geminiKey, t, e) });
  }
  return list;
}

async function generate(title: string, excerpt: string): Promise<Generated> {
  const list = providers();
  let lastError: unknown = null;
  for (const provider of list) {
    try {
      return await provider.run(title, excerpt);
    } catch (error) {
      console.error(`Article generation with ${provider.name} failed:`, error);
      lastError = error;
    }
  }
  throw lastError || new Error("No AI provider configured.");
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (req.method === "GET") {
    const rows = await db
      .select({
        slug: articles.slug,
        title: articles.title,
        description: articles.description,
        sections: articles.sections,
        published_at: articles.publishedAt,
      })
      .from(articles)
      .orderBy(desc(articles.publishedAt))
      .limit(50);
    return json(rows);
  }

  if (req.method === "POST" || req.method === "DELETE") {
    const body: any = await readBody(req);
    if (!body) return json({ success: false, error: "Invalid request." }, 400);
    if (!process.env.BLOG_ADMIN_PASSWORD) {
      return json({ success: false, error: "Publishing is not configured yet." }, 503);
    }
    if (!passwordMatches(String(body?.password || ""))) {
      return json({ success: false, error: "Incorrect password." }, 401);
    }

    if (req.method === "DELETE") {
      const slug = String(body?.slug || "").trim();
      if (!slug) return json({ success: false, error: "Missing article." }, 400);
      const deleted = await db.delete(articles).where(eq(articles.slug, slug)).returning({ slug: articles.slug });
      if (!deleted.length) return json({ success: false, error: "Article not found." }, 404);
      return json({ success: true, slug });
    }

    if (!providers().length) {
      return json(
        { success: false, error: "No AI provider is configured. Add GROQ_API_KEY or GEMINI_API_KEY in Netlify." },
        503,
      );
    }
    const title = String(body?.title || "").trim().slice(0, 200);
    const excerpt = String(body?.excerpt || "").trim().slice(0, 1000);
    if (!title || !excerpt) {
      return json({ success: false, error: "Title and summary are required." }, 400);
    }

    try {
      const article = await generate(title, excerpt);
      const [row] = await db
        .insert(articles)
        .values({ slug: slugify(article.title), ...article })
        .returning();
      return json({ success: true, article: { ...row, published_at: row.publishedAt } }, 201);
    } catch (error) {
      console.error("Article generation failed:", error);
      return json({ success: false, error: "The article could not be generated right now. Please try again." }, 502);
    }
  }

  return json({ success: false, error: "Method not allowed" }, 405);
};

export const config: Config = {
  path: "/api/articles",
};
