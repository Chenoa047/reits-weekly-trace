import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { BlackboardError } from './blackboard.ts';
import type { VisitorAuthProvider } from './blackboard-auth.ts';

// Configuration values are entered and managed by the owner in Vercel, never in source control.
// This client is used only in route handlers. The SDK manages all session cookies.
export async function createVisitorAuthProvider(): Promise<VisitorAuthProvider> {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new BlackboardError(503, '访客登录暂未开放，私密留言尚不可用。');
  const store = await cookies();
  const client = createServerClient(url, publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' },
    cookies: {
      getAll: () => store.getAll(),
      setAll: changes => { for (const { name, value, options } of changes) store.set(name, value, options); },
    },
  });
  return {
    async currentUser() {
      // getUser verifies identity with the auth server. Never trust the user in getSession().
      const { data, error } = await client.auth.getUser();
      if (error) {
        if (error.name === 'AuthSessionMissingError' || [400, 401, 403].includes(error.status || 0)) return null;
        throw new BlackboardError(503, '访客登录服务暂时不可用，请稍后重试。');
      }
      const user = data.user;
      return user?.id && user.email && user.email_confirmed_at && !user.is_anonymous
        ? { id: user.id, email: user.email } : null;
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new BlackboardError(error.status === 429 ? 429 : 503,
        error.status === 429 ? '验证码发送过于频繁，请稍后再试。' : '暂时无法发送验证码，请稍后重试或联系管理员。');
    },
    async verifyCode(email, code) {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new BlackboardError(error.status === 429 ? 429 : 400,
        error.status === 429 ? '验证过于频繁，请稍后再试。' : '验证码无效或已过期，请重新获取。');
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new BlackboardError(503, '暂时无法退出，请稍后重试。');
    },
  };
}
