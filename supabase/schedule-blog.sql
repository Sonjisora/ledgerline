select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'blog_project_url');
select vault.create_secret('PASTE_THE_SAME_RANDOM_BLOG_CRON_SECRET_SET_FOR_THE_FUNCTION', 'blog_cron_secret');

select cron.schedule(
  'generate-daily-blog',
  '0 9 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'blog_project_url'
    ) || '/functions/v1/generate-daily-blog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-blog-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'blog_cron_secret'
      )
    ),
    body := '{"source":"daily-schedule"}'::jsonb
  );
  $$
);
