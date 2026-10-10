import { fileURLToPath } from 'node:url'
import { MENUS, MENU_ROUTES } from './menus'

export default defineNuxtConfig({
  srcDir: 'app/',
  ssr: false,
  devtools: { enabled: false },
  experimental: {
    appManifest: false,
  },
  // Each Studio menu is a Nuxt layer in menus/<menu>/ (pages, views, components, utils) — menus/index.ts
  extends: MENUS.map(menu => `./menus/${menu}`),
  pages: true,
  hooks: {
    // 动态路由页面统一放在各菜单的 views/ 手动注册，避免文件路径中出现 [id] 方括号
    // （方括号路径在 git/shell 中需转义，且部分部署环境不兼容）。URL 保持不变。
      'pages:extend'(pages) {
        // เปิดแอป (/) → AI นักขาย (/seller); สตูดิโอละครอยู่ที่ /drama (menus/drama/pages/index.vue)
        // คลังสกิล (/studio) ไม่อยู่ในเมนู — รวมอยู่ใน AI นักขายแล้ว แต่ยังเข้าทาง URL ได้
        const dramaHome = pages.find(p => p.path === '/')
        if (dramaHome) dramaHome.path = '/drama'
        pages.push({ path: '/', redirect: '/seller' })
        for (const menu of MENUS) {
          for (const route of MENU_ROUTES[menu]) {
            pages.push({
              name: route.name,
              path: route.path,
              file: fileURLToPath(new URL(`./menus/${menu}/${route.view}`, import.meta.url)),
            })
          }
        }
      },
  },
  app: {
    head: {
      title: 'NAKA-AI',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        // v 参数用于 favicon 缓存穿透（浏览器对 favicon 缓存独立于 HTTP 缓存，换图必须 bump）
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg?v=5' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png?v=5' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=5' },
        { rel: 'shortcut icon', type: 'image/png', href: '/favicon.png?v=5' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&display=swap' },
      ],
    },
  },
  vite: {
    server: {
      proxy: {
        '/api': { target: 'http://localhost:5679', changeOrigin: true },
        '/static': { target: 'http://localhost:5679', changeOrigin: true },
      },
    },
  },
  compatibilityDate: '2025-05-15',
})
