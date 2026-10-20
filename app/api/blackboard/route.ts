import { getDb } from '@/db';
import { visitorBlackboardResponse } from '@/lib/blackboard-api';
import { verifiedBlackboardVisitor } from '@/lib/blackboard-identity';

export function GET(request: Request) {
  return visitorBlackboardResponse(request, { identity: verifiedBlackboardVisitor, db: getDb });
}

export function POST(request: Request) {
  return visitorBlackboardResponse(request, { identity: verifiedBlackboardVisitor, db: getDb });
}
