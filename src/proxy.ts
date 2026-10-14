import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only: no passcode cookie at all -> send to the passcode screen right away.
// The page and every API route still verify the cookie's value; this is not the security boundary.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("pakka_passcode")) {
    const url = new URL("/passcode", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/simulator",
};
