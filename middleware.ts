// ============================================================================
// NEXT.JS EDGE MIDDLEWARE — Auth Route Protection & Security Headers
// ============================================================================
//
// INVARIANT (MASTER_PROMPT.md §Core Path Protection & Auth):
//   - Middleware intercepts ALL requests before they reach API Route Handlers.
//   - Auth routes (/api/auth/challenge, /api/auth/verify) are PUBLIC — rate
//     limiter inside the handler itself enforces DOS protection.
//   - All other /api/* routes check for a valid session token in cookies or
//     the Authorization header. Returns 401 if missing.
//   - Frontend pages are public (no server session required for static assets).
//   - Middleware is STATELESS (Edge Runtime compatible). No DB calls here.
//   - Redis/Postgres/external services are NOT invoked in middleware.
//
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';

// Routes that are publicly accessible without a session token
const PUBLIC_API_PATHS = new Set([
  '/api/auth/challenge',
  '/api/auth/verify',
  '/api/auth/session',   // Session revalidation is public
  '/api/billing/plans',   // Read-only plan listing is public
  '/api/system/overview', // Health check is public
  '/api/market/chart',    // Chart data is public read-only
  '/api/market/macro',    // DefiLlama macro TVL signal is public read-only
  '/api/launchpad/tokens', // Public active token list from Neon SSOT
  '/api/launchpad/bounty', // Public bounty campaigns list from Neon SSOT
  '/api/launchpad/bounty/claim', // Public bounty claim & Merkle proof evaluation
  '/api/launchpad/bounty/verify-hodl', // Public HODL status & verification engine
  '/api/launchpad/curve-volatility', // Public curve slope parameters
  '/api/launchpad/keeper', // Keeper automation handles CRON_SECRET internally
  '/api/launchpad/webhook', // Webhook receiver handles signature/secret internally
]);

// Security headers applied to ALL responses
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'X-XSS-Protection':          '1; mode=block',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':         'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function extractBearerToken(req: NextRequest): string | null {
  // Check Authorization header: "Bearer <token>"
  const authHeader = req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // Check session cookie (set by /api/auth/verify on success)
  const sessionCookie = req.cookies.get('rtrader_session')?.value;
  if (sessionCookie) return sessionCookie;

  return null;
}

function isValidSessionToken(token: string): boolean {
  // Stateless validation: session tokens are structured as:
  //   base64(<userId>:<walletAddress>:<issuedAt>:<signature>)
  // For Edge middleware, we only validate format & presence.
  // Full cryptographic verification happens in the API route handler (RBAC).
  if (!token || token.length < 32) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    // Minimum: userId, wallet, issuedAt, signature = 4 parts
    return parts.length >= 4 && parts[0].length > 0;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Apply security headers to ALL responses ---
  const response = NextResponse.next();

  // --- API route protection ---
  if (pathname.startsWith('/api/')) {
    // Allow public API paths through without session check
    if (PUBLIC_API_PATHS.has(pathname)) {
      return applySecurityHeaders(response);
    }

    // Protected API routes require a valid session token
    const token = extractBearerToken(req);

    if (!token || !isValidSessionToken(token)) {
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Please sign in with your wallet via SIWE.',
          },
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
      return applySecurityHeaders(errorResponse);
    }

    // Valid token — forward request with security headers
    return applySecurityHeaders(response);
  }

  // --- Frontend pages pass through (public, no auth wall on UI) ---
  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
