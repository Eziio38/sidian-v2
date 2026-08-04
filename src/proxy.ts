import { NextResponse, type NextRequest } from "next/server";

import {
  createRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-id";
import { assertSupabaseDeploymentEnvironment } from "@/lib/supabase/environment-attestation";
import { updateSession } from "@/lib/supabase/proxy";

function requiresAuthRefresh(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export async function proxy(request: NextRequest) {
  const requestId = createRequestId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  let response: NextResponse;
  if (requiresAuthRefresh(request.nextUrl.pathname)) {
    try {
      await assertSupabaseDeploymentEnvironment();
      response = await updateSession(request, requestHeaders);
    } catch {
      response = NextResponse.json(
        { error: "service_unavailable" },
        { status: 503 },
      );
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set(REQUEST_ID_HEADER, requestId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
