// NAKA-AI back-office (system settings). Talks to the naka-drama-studio backend API.
//   NUXT_APP_BASE_URL        where this app is served (default /admin/ — the backend serves it there via ADMIN_DIST)
//   NUXT_PUBLIC_API_ORIGIN   backend origin when hosted elsewhere, e.g. https://naka.example.com (default: same origin)
//   NUXT_PUBLIC_MAIN_APP_URL link back to the user-facing app (default /)
export default defineNuxtConfig({
  srcDir: 'app/',
  ssr: false,
  devtools: { enabled: false },
  experimental: {
    appManifest: false,
  },
  runtimeConfig: {
    public: {
      apiOrigin: '',
      mainAppUrl: '/',
    },
  },
  app: {
    baseURL: '/admin/',
    head: {
      title: 'NAKA Admin',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/admin/logo.svg?v=5' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/admin/favicon.png?v=5' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/admin/apple-touch-icon.png?v=5' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Kanit:wght@500;600;700;800&display=swap' },
      ],
    },
  },
  vite: {
    server: {
      // dev: backend on 5679 (naka-drama-studio/backend → npm run dev)
      proxy: {
        '/api': { target: 'http://localhost:5679', changeOrigin: true },
        '/static': { target: 'http://localhost:5679', changeOrigin: true },
      },
    },
  },
  compatibilityDate: '2025-05-15',
})
