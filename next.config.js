/** @type {import('next').NextConfig} */
const nextConfig = {
  // Traces only the server files actually reachable at runtime. node_modules is
  // ~681 MB here, so without this the container image carries all of it and
  // pulls it over af-south-1 bandwidth on every deploy.
  output: 'standalone',

  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
  },

  // `next/image` is not used anywhere in the app, so no remotePatterns are
  // needed. Documents are served from S3 through short-lived presigned URLs,
  // never through the image optimiser.

  // Sent on every response. The app handles personal information under POPIA,
  // and none of these cost anything.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
