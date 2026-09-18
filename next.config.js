/** @type {import('next').NextConfig} */

/**
 * Content Security Policy.
 *
 * Next.js App Router inlines hydration data and, in this build, style tags, so
 * 'unsafe-inline' is required for both script and style until the app moves to
 * nonces via middleware. That is worth doing later; the policy below is still a
 * large improvement over having no CSP at all, because it removes the ability
 * to load script from any other origin.
 *
 * connect-src includes S3 so presigned uploads and downloads work.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.amazonaws.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // `upgrade-insecure-requests` is deliberately NOT set.
  //
  // It rewrites every subresource request to https, including same-origin ones.
  // On a deployment served over plain http - which the sandbox is, because it is
  // reached by IP and an IP cannot hold a certificate - the browser then asks for
  // every stylesheet, script chunk and font over a port that is not listening,
  // and the page renders as a bare unstyled shell with no JavaScript at all.
  //
  // It also earns almost nothing here. In production Caddy answers :80 with a 308
  // to :443, and the HSTS header below tells the browser never to try http again
  // for a year. Those two enforce the same thing without a footgun attached.
  //
  // Note this failure is invisible to curl, which ignores CSP entirely. It only
  // appears in a real browser - see scripts/browser-check.mjs.
].join('; ')

const nextConfig = {
  // Traces only the server files actually reachable at runtime. node_modules is
  // ~681 MB here, so without this the container image carries all of it and
  // pulls it over af-south-1 bandwidth on every deploy.
  output: 'standalone',

  // Do not advertise the framework version to every caller.
  poweredByHeader: false,

  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
  },

  // `next/image` is not used anywhere in the app, and documents are served from
  // S3 through short-lived presigned URLs rather than the optimiser. Disabling
  // it removes the /_next/image route entirely, which is where the AVIF
  // decoding vulnerability in this Next.js line lives. Nothing renders
  // differently, because nothing uses it.
  images: { unoptimized: true },

  // Sent on every response. The app handles personal information under POPIA,
  // and none of these cost anything.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // Nothing in the app uses these, so deny them outright rather than
          // leaving the defaults in place.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          // Isolates this browsing context from anything it opens or that
          // opens it.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          // X-XSS-Protection is deliberately absent. It is deprecated, ignored
          // by current browsers, and its filter was itself exploitable.
        ],
      },
    ]
  },
}

module.exports = nextConfig
