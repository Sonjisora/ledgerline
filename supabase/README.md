# Daily blog setup

The static blog page reads published articles from Supabase. A daily Supabase Cron job invokes an Edge Function, which asks Gemini for an article and stores it in the database. The Gemini API key and the scheduler secret stay server-side.

The generator is configured for the `gemini-4-hydrogen` free tier as of November 2026. Free-tier model access and quotas can change, and Google may use free-tier prompts and responses to improve its products. Do not send private customer, account, identity, or payment data to the model.

## 1. Create a Supabase project

Create a project in the Supabase dashboard and keep its project URL and publishable key handy. The Free plan currently includes a small database and scheduled functions, but free projects can be paused after inactivity. A paused project cannot serve the blog or run its scheduled job until resumed.

## 2. Apply the database migration and deploy the function

Install the Supabase CLI, then run these commands from the site folder:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy generate-daily-blog --no-verify-jwt
```

The function disables Supabase JWT verification because the scheduled call uses a separate random secret. The function checks that secret before doing any work.

## 3. Set private function secrets

Create a Gemini API key in Google AI Studio. In the Supabase dashboard, open **Edge Functions → Secrets** and set:

- `GEMINI_API_KEY`: your Gemini API key.
- `BLOG_CRON_SECRET`: a randomly generated, long secret. Use the same value in the SQL setup below.
- `GEMINI_MODEL`: optional; defaults to `gemini-4-hydrogen`.

Never put the Gemini key or the Supabase service-role/secret key in `blog-config.js`, HTML, or a public repository. Supabase supplies its server-side project URL and secret key to Edge Functions.

## 4. Configure daily scheduling

Open `schedule-blog.sql`, replace both placeholders with your project URL and the same random `BLOG_CRON_SECRET`, and run it in the Supabase SQL Editor. It stores the scheduler values in Supabase Vault and schedules one post per day at 09:00 UTC. Enable `pg_cron`, `pg_net`, and Vault if the SQL Editor reports that an extension is unavailable.

The generated articles publish automatically. Review the first few articles and monitor Gemini quotas, function logs, and scheduled-job status. The function skips a second post on the same UTC day and rejects malformed model output rather than publishing it.

## 5. Connect the public blog page

Set `supabaseUrl` and `publishableKey` in `blog-config.js` using the project URL and the public publishable key from Supabase project settings. The database policy allows anonymous reads only; it grants no public write access. Deploy `blog.html` and `blog-config.js` together with the rest of the site.

The page fetches post content client-side. This is convenient for a static site, but server-rendering or pre-rendering articles is preferable for dependable SEO indexing. A production deployment also requires hosting the files over HTTPS; opening them directly as `file://` will not provide a production-ready public blog.

## References

- [Supabase pricing](https://supabase.com/pricing)
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Gemini API pricing and free-tier terms](https://ai.google.dev/gemini-api/docs/pricing)
