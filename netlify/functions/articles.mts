import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { desc } from "drizzle-orm";
import { timingSafeEqual, createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { articles, type ArticleSection } from "../../db/schema.js";

const MODEL = "claude-haiku-5-5";

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

async function generate(title: string, excerpt: string): Promise<Generated> {
  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [
      {
        name: "publish_article",
        description: "Publish the finished blog article.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Final article title (max 110 characters)." },
            description: { type: "string", description: "120-160 character summary / meta description." },
            sections: {
              type: "array",
              description: "4-6 sections.",
              items: {
                type: "object",
                properties: {
                  heading: { type: "string" },
                  paragraphs: { type: "array", items: { type: "string" }, description: "2-4 paragraphs." },
                },
                required: ["heading", "paragraphs"],
              },
            },
          },
          required: ["title", "description", "sections"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "publish_article" },
    system:
      "You write clear, practical, original blog articles for Ledgerline, a site serving online business owners. " +
      "Write in plain English with concrete, useful advice. Do not invent statistics, quotes, or legal guarantees. " +
      "Plain text only in paragraphs (no markdown).",
    messages: [
      {
        role: "user",
        content: `Write a blog article.\n\nWorking title: ${title}\n\nWhat it should cover:\n${excerpt}`,
      },
    ],
  });
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("The model did not return an article.");
  return validate(block.input);
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

  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "Invalid request." }, 400);
    }
    if (!process.env.BLOG_ADMIN_PASSWORD) {
      return json({ success: false, error: "Publishing is not configured yet." }, 503);
    }
    if (!passwordMatches(String(body?.password || ""))) {
      return json({ success: false, error: "Incorrect publishing password." }, 401);
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
