import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devServer: { host: '127.0.0.1', port: 3150 },
  devtools: { enabled: false },
  runtimeConfig: {
    repoRoot: fileURLToPath(new URL('..', import.meta.url)),
    dataDir: '',
    adminToken: '',
    distDir: '',
    webhookAllowPrivate: '',
    // NUXT_PUBLIC_STATIC_SCREEN=1 at `nuxt generate` (GitHub Pages): /screen reads public/static/ instead of
    // /api. Read here because a `ssr: false` generate does not carry runtime env into the client.
    public: { staticScreen: process.env.NUXT_PUBLIC_STATIC_SCREEN ?? '' },
  },
  nitro: { prerender: { routes: ['/screen'] } },
  css: [
    '@fontsource/noto-sans-jp/400.css',
    '@fontsource/noto-sans-jp/700.css',
    '@fontsource/noto-sans/400.css',
    '@fontsource/noto-sans/600.css',
    '@fontsource/noto-sans/700.css',
    '@fontsource/noto-sans-sc/400.css',
    '@fontsource/noto-sans-sc/700.css',
    '@fontsource/noto-sans-tc/400.css',
    '@fontsource/noto-sans-tc/700.css',
    '@fontsource/noto-sans-kr/400.css',
    '@fontsource/noto-sans-kr/700.css',
    '@fontsource/noto-sans-thai/400.css',
    '@fontsource/noto-sans-thai/700.css',
    '~/assets/screen.css',
  ],
  app: {
    head: {
      htmlAttrs: { lang: 'ja' },
      title: 'EVAC LAYER',
    },
  },
})
