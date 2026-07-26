/** @type {import('next').NextConfig} */

// Security headers. The app previously sent none, which left it framable
// (a commissioner could be clickjacked into destructive admin clicks) and
// leaked full referrer URLs — league ids and invite codes appear in paths.
//
// CSP notes: Next's App Router needs 'unsafe-inline' for its inline bootstrap
// scripts, and 'unsafe-eval' in development only. connect-src must allow the
// Supabase project (REST, Auth, Edge Functions) and img-src the ESPN CDN that
// serves team logos.
const isDev = process.env.NODE_ENV === "development";

const supabaseOrigin =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ceaortdycialvyddctex.supabase.co";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://a.espncdn.com https://a1.espncdn.com https://a2.espncdn.com https://a3.espncdn.com",
  `connect-src 'self' ${supabaseOrigin} https://*.supabase.co`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
