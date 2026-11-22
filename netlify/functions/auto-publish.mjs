export default async (req) => {
  const { next_run } = await req.json();

  // 1. Pick a topic from a queue/database table (avoid repeating used topics)
  const topic = "How to structure international business operations";

  // 2. Call Groq's OpenAI-compatible chat completions endpoint
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Return valid JSON with keys: "title", "slug", "metaDescription", "excerpt", "contentMarkdown". Write an original, well-structured, helpful article.',
        },
        {
          role: "user",
          content: `Write a comprehensive guide on: ${topic}`,
        },
      ],
    }),
  });

  const data = await groqRes.json();
  const article = JSON.parse(data.choices[0].message.content);

  // 3. Save `article` to your database (Supabase, Neon/Postgres, or Netlify Blobs)
  // await savePostToDatabase(article);

  console.log(`Published: ${article.title} | Next run: ${next_run}`);
};

export const config = {
  schedule: "0 */4 * * *", // Runs every 4 hours (UTC)
};