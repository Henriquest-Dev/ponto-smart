import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware leve (Edge): apenas verifica a presença do cookie de sessão.
 * A validação real da sessão, empresa e permissões é feita no servidor (Node)
 * em cada página/rota — nunca confiar só no middleware.
 */
const PROTECTED = ["/app", "/empresa", "/admin", "/conta", "/estacao"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.has("ps_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/empresa/:path*", "/admin/:path*", "/conta/:path*", "/estacao/:path*"],
};
