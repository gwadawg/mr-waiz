import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Middleware clones request bodies (default 10MB). Onboarding headshots can be
  // larger phone photos; truncated multipart bodies fail with
  // "Failed to parse body as FormData." Match client-headshots storage limit.
  experimental: {
    proxyClientMaxBodySize: "30mb",
  },
  // Launch Kit PDFs render server-side; keep the renderer out of the bundler.
  serverExternalPackages: ["@react-pdf/renderer"],
  async rewrites() {
    return [
      // Public client offer pages (static HTML under public/offers/)
      {
        source: "/offers/team-westside",
        destination: "/offers/team-westside/index.html",
      },
      {
        source: "/offers/team-westside/",
        destination: "/offers/team-westside/index.html",
      },
      {
        source: "/offers/team-westside/pay",
        destination: "/offers/team-westside/pay.html",
      },
      {
        source: "/offers/team-westside/post-pay",
        destination: "/offers/team-westside/post-pay.html",
      },
      {
        source: "/offers/senior-media-buyer",
        destination: "/offers/senior-media-buyer/index.html",
      },
      {
        source: "/offers/senior-media-buyer/",
        destination: "/offers/senior-media-buyer/index.html",
      },
      {
        source: "/offers/mandi-stephens",
        destination: "/offers/mandi-stephens/index.html",
      },
      {
        source: "/offers/mandi-stephens/",
        destination: "/offers/mandi-stephens/index.html",
      },
      {
        source: "/offers/romik-yeghnazary",
        destination: "/offers/romik-yeghnazary/index.html",
      },
      {
        source: "/offers/romik-yeghnazary/",
        destination: "/offers/romik-yeghnazary/index.html",
      },
      {
        source: "/offers/steven-spear",
        destination: "/offers/steven-spear/index.html",
      },
      {
        source: "/offers/steven-spear/",
        destination: "/offers/steven-spear/index.html",
      },
      {
        source: "/offers/russ-rich",
        destination: "/offers/russ-rich/index.html",
      },
      {
        source: "/offers/russ-rich/",
        destination: "/offers/russ-rich/index.html",
      },
      {
        source: "/offers/chuck-eueno",
        destination: "/offers/chuck-eueno/index.html",
      },
      {
        source: "/offers/chuck-eueno/",
        destination: "/offers/chuck-eueno/index.html",
      },
    ];
  },
};

export default nextConfig;
