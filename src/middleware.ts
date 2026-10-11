import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  decideOfferLetterRequest,
  isOfferLetterHost,
  PRIVATE_HEADERS,
  PRIVATE_LINK_HTML,
} from '../offer-letters/gate';

// Routes that handle their own auth (API key or admin secret) or are public
const BYPASS_ROUTES = [
  '/api/webhooks',
  '/api/ad-spend',
  '/api/meta-ad-insights',
  '/api/admin/onboard',
  '/api/admin/backfill-acquisition-dials',
  '/api/admin/clients',
  '/api/onboard',
  '/api/billings/reminders',
  '/api/setup',
  '/api/users',
  '/setup',
  '/login',
  '/onboard',
  '/auth',
  '/report',
  '/forms/acquisition',
  '/forms/eod',
  '/forms/loans',
  '/forms/closebot-tickets',
  '/api/forms/loans',
  '/api/closebot/tickets/public',
  '/tools/lead-source-roi',
  '/thank-you',
  '/offers/',
  '/card',
  '/api/acquisition/forms',
  '/api/eod',
  '/api/acquisition/webhooks',
  '/api/acquisition/ad-insights',
  // /api/onboard/* already covered by '/api/onboard' above
];

const CARD_HOSTS = new Set(['loanofficer.me', 'www.loanofficer.me']);

/** App surfaces that must not be reachable on the card domain. */
const CARD_HOST_BLOCKED = [
  '/api',
  '/login',
  '/auth',
  '/setup',
  '/dashboard',
  '/onboard',
  '/forms',
  '/report',
  '/tools',
  '/library',
  '/offers',
];

function isCardHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0]?.toLowerCase() ?? '';
  return CARD_HOSTS.has(host);
}

function isBlockedOnCardHost(pathname: string): boolean {
  return CARD_HOST_BLOCKED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * loanofficer.me/{slug} → /card/{slug} (public, no auth).
 * Root → /card stub. Internal Mr. Waiz routes are not exposed on this host.
 */
function handleCardHost(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  if (pathname === '/' || pathname === '') {
    return NextResponse.rewrite(new URL('/card', request.url));
  }

  if (pathname.startsWith('/card')) {
    return NextResponse.next();
  }

  if (isBlockedOnCardHost(pathname)) {
    return NextResponse.rewrite(new URL('/card', request.url));
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/card${pathname}`;
  return NextResponse.rewrite(rewriteUrl);
}

function handleOfferLetterHost(request: NextRequest): NextResponse {
  const decision = decideOfferLetterRequest(request.headers.get('host'), request.nextUrl.pathname);
  if (decision.kind === 'serve') {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/offer-letters/${decision.slug}/${decision.token}`;
    return NextResponse.rewrite(rewriteUrl);
  }
  return new NextResponse(PRIVATE_LINK_HTML, { status: 404, headers: PRIVATE_HEADERS });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isOfferLetterHost(request.headers.get('host'))) {
    return handleOfferLetterHost(request);
  }

  if (isCardHost(request.headers.get('host'))) {
    return handleCardHost(request);
  }

  if (BYPASS_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // API routes authenticate in-handler via getAuthContext(). Skipping middleware
  // here removes a duplicate Supabase getUser() round-trip on every fetch.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  // Skip /api/onboard entirely so multipart headshot uploads are not body-cloned
  // through middleware (avoids the default 10MB truncate → FormData parse errors).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/onboard|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)',
  ],
};
