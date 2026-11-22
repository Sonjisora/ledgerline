export default async (req) => {
  try {
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
        model: "llama-3.1-8b-instant",
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

    // Check if the request was successful
    if (!groqRes.ok) {
      const errorText = await groqRes.text();
      console.error("Groq API error:", errorText);
      return console.log(
        `Published: Groq API failed with status ${groqRes.status}`
      );
    }

    const data = await groqRes.json();

    // 3. Safely extract the article content from Groq response
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Unexpected Groq response structure:", data);
      return console.log(
        "Published: Unexpected Groq response structure"
      );
    }

    const article = JSON.parse(data.choices[0].message.content);

    // 4. Save `article` to your database (Supabase, Neon/Postgres, or Netlify Blobs)
    // await savePostToDatabase(article);

    console.log(`Published: ${article.title} | Next run: ${new Date().toISOString()}`);
  } catch (error) {
    console.error("Error in auto-publish function:", error);
  }
};

export const config = {
  schedule: "0 */4 * * *", // Runs every 4 hours (UTC)
};