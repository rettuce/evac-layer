export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devServer: { host: '127.0.0.1', port: 3150 },
  devtools: { enabled: false },
  css: [
    '@fontsource/noto-sans-jp/400.css',
    '@fontsource/noto-sans-jp/700.css',
    '@fontsource/noto-sans/400.css',
    '@fontsource/noto-sans/700.css',
    '@fontsource/noto-sans-sc/400.css',
    '@fontsource/noto-sans-sc/700.css',
    '@fontsource/noto-sans-tc/400.css',
    '@fontsource/noto-sans-tc/700.css',
    '@fontsource/noto-sans-kr/400.css',
    '@fontsource/noto-sans-kr/700.css',
    '~/assets/screen.css',
  ],
  app: {
    head: {
      htmlAttrs: { lang: 'ja' },
      title: 'EVAC LAYER',
    },
  },
})
