declare namespace NodeJS {
  interface ProcessEnv {
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
    ADMIN_PASSWORD?: string;
    CRON_SECRET?: string;
    DEEPSEEK_API_KEY?: string;
  }
}
