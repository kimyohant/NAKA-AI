/**
 * ระบบผู้ดูแล (admin/) — หน้าตั้งค่าระบบ (บริการ AI, สไตล์, เอเจนต์, ที่จัดเก็บ…) ย้ายไปอยู่ที่นั่น
 * ค่าเริ่มต้น /admin/ (backend เสิร์ฟให้เมื่อตั้ง ADMIN_DIST); โฮสต์แยก → NUXT_PUBLIC_ADMIN_URL
 */
export function useAdminUrl(): string {
  const url = useRuntimeConfig().public.adminUrl
  return typeof url === 'string' && url ? url : '/admin/'
}

export function openAdmin(path = '') {
  const base = useAdminUrl()
  window.open(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, '_blank', 'noopener')
}
