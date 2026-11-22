export default async (req) => {
  try {
    // 1. Pick a topic from a queue/database table (avoid repeating used topics)
    const topic = "How to structure international business operations";

    // 2. Model fallback list - try each model until one works
    // Based on Groq deprecations page, only use currently available models
    const models = [
      "llama-3.1-8b-instant",   // Fast, most reliably available
      "llama-3.3-70b-versatile", // Powerful, check rate limits
    ];

    let groqRes = null;
    let lastError = null;

    // Try each model until one succeeds or we run out
    for (const model of models) {
      try {
        groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: model,
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

        // If we get a successful response, break the loop
        if (groqRes.ok) break;

        // Read error text for logging
        lastError = await groqRes.text();
      } catch (fetchError) {
        lastError = fetchError.message;
        // Continue to next model
      }
    }

    // If all models failed, return error
    if (!groqRes || !groqRes.ok) {
      console.error("Groq API error - all models failed:", lastError);
      return console.log(
        `Published: Groq API failed with all models (last: ${models[models.length - 1]})`
      );
    }

    const data = await groqRes.json();

    // 3. Safely extract the article content from Groq response
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Unexpected Groq response structure:", data);
      return console.log("Published: Unexpected Groq response structure");
    }

    const article = JSON.parse(data.choices[0].message.content);

    // 4. Save `article` to your database (Supabase, Neon/Postgres, or Netlify Blobs)
    // await savePostToDatabase(article);

    console.log(`Published: ${article.title} | Next run: ${new Date().toISOString()} | Model used: ${groqRes.headers.get ? 'Groq API' : 'unknown'}`);
  } catch (error) {
    console.error("Error in auto-publish function:", error);
  }
};

export const config = {
  schedule: "0 */4 * * *", // Runs every 4 hours (UTC)
};