/**
 * NAKA Admin API client — same endpoints as the naka-drama-studio frontend, plus:
 * - every request carries X-Admin-Token (the backend guards the system-settings API with ADMIN_TOKEN)
 * - backend origin is configurable (NUXT_PUBLIC_API_ORIGIN) for hosting the admin on another domain
 * - 401 E_ADMIN_REQUIRED → forget the token and go back to the login page
 */
import { adminTokenValue, onAdminUnauthorized } from '~/composables/useAdminAuth'

function apiOrigin(): string {
  try {
    const o = useRuntimeConfig().public.apiOrigin
    return typeof o === 'string' ? o.replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

const base = () => `${apiOrigin()}/api/v1`

/** /static/... files live on the backend — prefix the backend origin when the admin is hosted elsewhere */
export function mediaUrl(p?: string | null): string {
  if (!p) return ''
  if (/^(https?:|data:|blob:)/.test(p)) return p
  return `${apiOrigin()}${p.startsWith('/') ? p : `/${p}`}`
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = adminTokenValue()
  return token ? { ...extra, 'X-Admin-Token': token } : extra
}

async function handle<T>(resp: Response, method: string, path: string): Promise<T> {
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || (json.code && json.code >= 400)) {
    if (resp.status === 401 && json.errorCode === 'E_ADMIN_REQUIRED') onAdminUnauthorized()
    console.log(`%c[API] %c${method} ${path} %c${resp.status}`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', json.message || '')
    throw Object.assign(new Error(json.message || `${resp.status}`), { errorCode: json.errorCode || undefined, status: resp.status })
  }
  return json.data ?? json
}

async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: authHeaders({ 'Content-Type': 'application/json' }) }
  if (body) opts.body = JSON.stringify(body)
  return handle<T>(await fetch(`${base()}${path}`, opts), method, path)
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: <T = any>(p: string, b?: any) => req<T>('POST', p, b),
  put: <T = any>(p: string, b?: any) => req<T>('PUT', p, b),
  del: <T = any>(p: string) => req<T>('DELETE', p),
}

/** login check: 200 with a valid token (or when the backend runs without ADMIN_TOKEN) */
export const adminAPI = {
  session: (token: string) => fetch(`${base()}/admin/session`, { headers: token ? { 'X-Admin-Token': token } : {} })
    .then(r => handle<{ admin: boolean; guard: boolean }>(r, 'GET', '/admin/session')),
}

async function uploadReq<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  return handle<T>(await fetch(`${base()}${path}`, { method: 'POST', body: fd, headers: authHeaders() }), 'POST', path)
}

export const uploadAPI = {
  image: (f: File) => uploadReq<{ url: string; path: string }>('/upload/image', f),
}

export const taskAPI = {
  generate: (d: any) => api.post('/tasks', d),
  preflight: (d: any) => api.post('/tasks/preflight', d),
  get: (id: number) => api.get(`/tasks/${id}`),
  recover: (id: number) => api.post(`/tasks/${id}/recover`, {}),
  del: (id: number) => api.del(`/tasks/${id}`),
  list: (params?: { type?: 'image' | 'video'; drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.type) query.set('type', params.type)
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    return api.get(`/tasks${query.size ? `?${query.toString()}` : ''}`)
  },
  // 按集聚合生成任务（sys_task + video_merges）
  listByEpisode: (episodeId: number) => api.get<{ tasks: any[]; merges: any[] }>(`/episodes/${episodeId}/generation-tasks`),
}

export const aiConfigAPI = {
  list: (t?: string) => api.get(`/ai-configs${t ? `?service_type=${t}` : ''}`),
  create: (d: any) => api.post('/ai-configs', d),
  update: (id: number, d: any) => api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: any) => api.post('/ai-configs/test', d),
}

// lang 缺省/为 zh 时读写基础版（不带 query，保持原请求形态）
const langQ = (lang?: string) => (lang && lang !== 'zh' ? `?lang=${lang}` : '')

export const promptAPI = {
  list: () => api.get('/prompts'),
  get: (type: string, lang?: string) => api.get(`/prompts/${type}${langQ(lang)}`),
  update: (type: string, d: any, lang?: string) => api.put(`/prompts/${type}${langQ(lang)}`, d),
  reset: (type: string, lang?: string) => api.post(`/prompts/${type}/reset${langQ(lang)}`),
}

export const skillsAPI = {
  list: (lang?: string) => api.get(`/skills${langQ(lang)}`),
  library: (lang?: string) => api.get(`/skills/library${langQ(lang)}`),
  install: (id: string) => api.post(`/skills/library/${id}`, {}),
  get: (id: string, lang?: string) => api.get(`/skills/${id}${langQ(lang)}`),
  create: (data: { id: string; name: string; description?: string }) => api.post('/skills', data),
  update: (id: string, content: string, lang?: string) => api.put(`/skills/${id}${langQ(lang)}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
}

export const stylePresetAPI = {
  list: (all = false) => api.get(`/style-presets${all ? '?all=1' : ''}`),
  create: (d: any) => api.post('/style-presets', d),
  update: (id: number, d: any) => api.put(`/style-presets/${id}`, d),
  del: (id: number) => api.del(`/style-presets/${id}`),
  // Style Gallery — นำเข้าคลังสไตล์เลขที่ 305 แบบ (idempotent — ข้ามสิ่งที่มีอยู่แล้ว)
  importBuiltin: () => api.post<{ imported: number; skipped: number }>('/style-presets/import-builtin', {}),
}

export const storageAPI = {
  info: () => api.get('/storage'),
}

export const settingsAPI = {
  contentLanguage: () => api.get<{ language: string }>('/settings/content-language'),
  setContentLanguage: (language: string) => api.put('/settings/content-language', { language }),
}

export const serverUpdateAPI = {
  state: () => api.get('/server-update/state'),
  check: () => api.post('/server-update/check'),
  apply: () => api.post('/server-update/apply'),
}

