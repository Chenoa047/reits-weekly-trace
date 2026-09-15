declare namespace NodeJS {
  interface ProcessEnv {
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
    ADMIN_PASSWORD?: string;
    DEEPSEEK_API_KEY?: string;
    CNB_API_TOKEN?: string;
    CNB_REPO_SLUG?: string;
  }
}
