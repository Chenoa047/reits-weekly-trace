import { visitorAuthResponse } from '@/lib/blackboard-auth';
import { createVisitorAuthProvider } from '@/lib/blackboard-supabase';

export function GET(request: Request) {
  return visitorAuthResponse(request, createVisitorAuthProvider);
}

export function POST(request: Request) {
  return visitorAuthResponse(request, createVisitorAuthProvider);
}
