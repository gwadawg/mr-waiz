import type { Metadata } from "next";
import { headers } from "next/headers";
import { BRAND_FAVICON_PATH, showsBrandFavicon } from "@/lib/brand-favicon";
import "@/styles/fonts.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const branded = showsBrandFavicon(
    headerList.get("x-forwarded-host"),
    headerList.get("host"),
  );

  return {
    title: "Mr. Waiz — Reporting Dashboard",
    description: "Reverse mortgage call center reporting dashboard",
    icons: branded
      ? { icon: [{ url: BRAND_FAVICON_PATH, type: "image/png", sizes: "192x192" }] }
      : {},
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
