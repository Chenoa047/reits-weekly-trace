# GitHub + Vercel deployment

This project runs on Next.js with a Turso/libSQL database and is designed for Vercel.

## Required environment variables

Configure these values directly in the Vercel project settings. Never commit their values:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `DEEPSEEK_API_KEY`
- `ADMIN_PASSWORD`
- `CRON_SECRET`

## Database initialization

Create a Turso database, open its SQL console, and run `db/turso-init.sql` once.

## Scheduled refresh

`vercel.json` schedules `/api/tasks/daily-refresh` at 00:30 and 10:30 UTC, corresponding to 08:30 and 18:30 in Beijing. Vercel sends `CRON_SECRET` in the `Authorization` header for each invocation.

## Deployment

1. Push the repository to a private GitHub repository.
2. Import only that repository into Vercel.
3. Add the five environment variables above for Production.
4. Deploy and verify the public pages before testing administrator actions.
