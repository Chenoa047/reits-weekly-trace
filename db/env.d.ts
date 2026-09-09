declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_PASSWORD?: string;
    CRON_SECRET?: string;
  }
}
