import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kimi-mc",
  description: "网页版体素沙盒 · Next.js + shadcn/ui + Three.js",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "kimi-mc",
  },
};

export const viewport: Viewport = {
  themeColor: "#5d9445",
  // 游戏内双指缩放/滚动由触控层接管，禁用页面缩放
  maximumScale: 1,
  userScalable: false,
};

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
