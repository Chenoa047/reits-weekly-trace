import { BlackboardError } from './blackboard.ts';

export type BlackboardVisitorIdentity = { subject: string };

// Read only the stable public account ID returned by server-verified Supabase identity.
export async function verifiedBlackboardVisitor(_request: Request): Promise<BlackboardVisitorIdentity | null> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)
    throw new BlackboardError(503, '访客登录暂未开放，私密留言尚不可用。');
  const { createVisitorAuthProvider } = await import('./blackboard-supabase.ts');
  const user = await (await createVisitorAuthProvider()).currentUser();
  return user ? { subject: `supabase:${user.id}` } : null;
}
