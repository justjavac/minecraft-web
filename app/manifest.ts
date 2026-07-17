import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'kimi-mc',
    short_name: 'kimi-mc',
    description: '网页版体素沙盒 · Next.js + shadcn/ui + Three.js',
    start_url: '/',
    display: 'standalone',
    background_color: '#87ceeb',
    theme_color: '#5d9445',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
