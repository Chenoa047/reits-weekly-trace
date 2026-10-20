import { BlackboardError } from './blackboard.ts';

export type BlackboardVisitorIdentity = { subject: string };

// Integration boundary: the owner supplies an existing, server-verified visitor login here.
// Return the provider's stable public account ID, or null when logged out.
// Never trust identity/email supplied in request bodies, query strings or unverified headers.
// No credentials or sessions are created, read, or managed by this placeholder.
export async function verifiedBlackboardVisitor(_request: Request): Promise<BlackboardVisitorIdentity | null> {
  throw new BlackboardError(503, '访客登录暂未开放，私密留言尚不可用。');
}
