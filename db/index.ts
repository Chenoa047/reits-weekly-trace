import { createClient, type Client, type InValue, type Row } from '@libsql/client';

let client: Client | null = null;

export type AppDb = ReturnType<typeof createDbAdapter>;

export function getDb(): AppDb {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('Turso 数据库尚未配置。');

  client ??= createClient({ url, authToken });
  return createDbAdapter(client);
}

function createDbAdapter(db: Client) {
  return {
    prepare(sql: string) {
      let args: InValue[] = [];
      const statement = {
        bind(...values: InValue[]) {
          args = values;
          return statement;
        },
        async all<T extends Record<string, unknown>>() {
          const result = await db.execute({ sql, args });
          return { results: result.rows.map((row) => rowToObject<T>(row)) };
        },
        async first<T extends Record<string, unknown>>() {
          const result = await db.execute({ sql, args });
          return result.rows[0] ? rowToObject<T>(result.rows[0]) : null;
        },
        async run() {
          return db.execute({ sql, args });
        },
      };
      return statement;
    },
  };
}

function rowToObject<T extends Record<string, unknown>>(row: Row): T {
  return { ...row } as unknown as T;
}
