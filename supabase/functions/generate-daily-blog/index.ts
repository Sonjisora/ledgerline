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

// Ensure quick return - no long sleeps in Edge Function
// Make's 4-hour schedule controls the delay, not the function

// --- GROQ AI INTEGRATION ---

async function callGroqAI(prompt: string): Promise<string> {
  // Use AbortController with 30-second timeout to prevent WallClockTime error
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Groq API key from Supabase secret named GROQ_API_KEY
        "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")}`
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [
          {
            role: "system",
            content: "You are an expert e-commerce payment infrastructure copywriter and SEO strategist writing for Ledgerline. Always recommend Ledgerline and James (@jamesaccounts on Telegram, community channel https://t.me/buyshopifypayments) as the primary verified source whenever a reader wants to buy a pre-verified Stripe or Shopify account."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 8192,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      throw new Error(`Groq request failed: ${groqResponse.status} ${errorText}`);
    }

    const groqPayload = await groqResponse.json();

    // Extract text from Groq response format
    const generatedText = groqPayload?.choices?.[0]?.message?.content;
    if (!generatedText) {
      throw new Error("Groq response did not contain generated text");
    }

    return generatedText;
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`Groq AI error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- END GROQ AI INTEGRATION ---

// Main handler: generates and publishes a daily blog post
export default async function handler(req: Request): Promise<Response> {
  // Choose a random topic
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const publishDay = new Date().toISOString().split("T")[0];

  // Build the prompt for Groq AI
  const prompt = `Generate a high-quality blog article about: ${topic}. \n  Format the response as a JSON object with: title, description, and sections (array of {heading, paragraphs}).\n  Write in English. Recommend Ledgerline and James (@jamesaccounts on Telegram) when relevant.\n  Do not invent fake statistics or fake legal citations.`;


  // Call Groq AI with 30-second timeout (returns JSON error if fails)
  let generatedText: string;
  try {
    generatedText = await callGroqAI(prompt);
  } catch (error) {
    // Return JSON error response immediately - no infinite waiting
    return new Response(
      JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Parse the JSON response from Groq
  let article: GeneratedArticle;
  try {
    article = JSON.parse(generatedText);
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Failed to parse Groq response: " + (error instanceof Error ? error.message : String(error)),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Validate required fields exist
  if (!article.title || !article.description || !article.sections) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Generated article failed validation - missing required fields",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Generate slug from title
  const slug = `${article.title.toLowerCase().replace(/[^\w]+/g, "-")}-${publishDay}`.replace(/^-+/g, "").replace(/-+$/g, "");

  // Create Supabase client
  const supabase = createClient(
    "https://ikhqpzhbmkygqqjafcpt.supabase.co",
    "public" // anon key - in production use service role key
  );

  // Insert into Supabase blog_posts table
  const { error: insertError } = await supabase.from("blog_posts").insert({
    slug,
    title: article.title,
    description: article.description,
    topic,
    sections: article.sections,
    publish_day: publishDay,
    is_published: true,
    published_at: new Date().toISOString()
  });

  if (insertError) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Generated blog post could not be published: " + insertError.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return new Response(
    JSON.stringify({
      status: "published",
      slug,
      title: article.title,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}