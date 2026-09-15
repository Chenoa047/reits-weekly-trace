# CNB + EdgeOne deployment

CNB owns the scheduled and administrator-triggered scraping jobs. EdgeOne hosts the Next.js site and only reads data or submits a CNB job.

## 1. Database

- New database: run `db/turso-init.sql` once.
- Existing database: run `drizzle/0001_cnb_refresh_jobs.sql` once in the Turso SQL console.

## 2. CNB repository and secrets

Create a private CNB repository and make it the primary remote. Keep the existing GitHub repository as a migration snapshot.

Create two files in a private CNB secret repository, then replace `REPLACE_WITH_YOUR_SECRET_REPO` in `.cnb.yml` with that repository path:

`reits-refresh.env.yml`:

```yaml
allow_slugs:
  - YOUR_ORGANIZATION/reits-weekly-trace
allow_events:
  - crontab
  - api_trigger_manual_refresh
allow_branches:
  - main
TURSO_DATABASE_URL: ENTER_IN_CNB
TURSO_AUTH_TOKEN: ENTER_IN_CNB
DEEPSEEK_API_KEY: ENTER_IN_CNB
```

`reits-deploy.env.yml`:

```yaml
allow_slugs:
  - YOUR_ORGANIZATION/reits-weekly-trace
allow_events:
  - push
allow_branches:
  - main
EDGEONE_PROJECT_NAME: reits-weekly-trace
EDGEONE_API_TOKEN: ENTER_IN_CNB
```

Replace `YOUR_ORGANIZATION/reits-weekly-trace` with the exact slug of the main CNB repository. Replace each `ENTER_IN_CNB` placeholder yourself in the private secret repository; never send or commit those values to the application repository.

Enter all values yourself in CNB. Never commit the values or print them in build logs.

The `main` branch runs three pipelines:

- Push: test, build, and deploy EdgeOne.
- `crontab: 0 9 * * *`: refresh every day at 09:00 Asia/Shanghai.
- `api_trigger_manual_refresh`: asynchronous administrator refresh.

## 3. EdgeOne environment variables

Configure these server-side variables in the EdgeOne project:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `ADMIN_PASSWORD`
- `CNB_API_TOKEN`
- `CNB_REPO_SLUG`

Create the CNB token yourself with only the repository build-trigger permission. Do not prefix any secret with `NEXT_PUBLIC_`.

## 4. Verification

1. Push `main` and confirm the test/build/deploy pipeline succeeds.
2. Log in to the website administrator panel and submit a refresh.
3. Confirm the page moves through queued and running to ok, partial, or failed.
4. Close the page during a run, reopen it, log in, and confirm status tracking resumes.
5. Confirm the CNB scheduled pipeline runs once at 09:00 Asia/Shanghai.
