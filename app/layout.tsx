import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://k3mc.jjc.fun"),
  title: "kimi-mc",
  description: "网页版体素沙盒 · Next.js + shadcn/ui + Three.js",
  openGraph: {
    title: "kimi-mc",
    description: "浏览器里的 Minecraft：生存、创造、探索——无需安装，打开网页即玩",
    url: "https://k3mc.jjc.fun",
    siteName: "kimi-mc",
    type: "website",
  },
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
