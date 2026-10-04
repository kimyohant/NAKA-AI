import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { getTextProviderBaseUrl, isOfficialProvider, parseConfigTemperature } from '../services/ai.js'
import { redactUrl, logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import { parseUnitPrice } from '../services/generation-cost.js'

const app = new Hono()

/** 归一化 temperature 入参：null=未设置；合法值 0~2；非法抛错 */
function normalizeTemperature(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error('invalid temperature')
  return n
}

/** 把 settings JSON 中的 temperature 透出为顶层字段，便于前端直接读写 */
function withParsedFields(r: any) {
  const { api_key: _apiKey, ...publicFields } = toSnakeCase(r)
  let settings: Record<string, any> = {}
  try { settings = r.settings ? JSON.parse(r.settings) : {} } catch { /* legacy settings */ }
  return {
    ...publicFields,
    has_api_key: Boolean(r.apiKey),
    model: r.model ? JSON.parse(r.model) : [],
    temperature: parseConfigTemperature(r.settings),
    price_thb_per_image: settings.price_thb_per_image ?? null,
    price_thb_per_video_second: settings.price_thb_per_video_second ?? null,
  }
}

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function buildProbe(serviceType: string, provider: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = provider.toLowerCase()
  const m = model || ''

  if (p === 'gemini') {
    // 探针统一走 generateContent:文本运行时(AI SDK)走的就是它,官方与中转站都支持;
    // interactions 端点很多中转站未配置,探它会误报 500。
    // 用最小合法请求体而非空体——空体在部分中转站会触发上游认证失败的误报
    const modelName = m || 'gemini-3.1-pro-preview'
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${modelName}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return {
      method: 'POST',
      url: url.toString(),
      headers: geminiHeaders(apiKey, true),
      body: { contents: [{ parts: [{ text: 'hi' }] }] },
    }
  }

  if (p === 'openai') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (serviceType === 'text' && ['zai', 'deepseek', 'qwen', 'moonshot', 'xai'].includes(p)) {
    const endpoint = getTextProviderBaseUrl({ provider: p, baseUrl, apiKey: apiKey || '', model: m })
    return {
      method: 'POST',
      url: joinProviderUrl(endpoint, '', '/chat/completions'),
      headers: bearerHeaders(apiKey, true),
      body: { model: m, messages: [{ role: 'user', content: 'Reply OK.' }], stream: false },
    }
  }

  if (p === 'volcengine') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : serviceType === 'text'
        ? '/chat/completions'
        : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    // MiniMax 仅提供视频服务，空请求体探测鉴权/端点连通性
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v2', '/video_generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'aliyun') {
    // Wan 3.0 仅支持异步提交；空请求体不会创建计费任务，仅用于验证地域端点与鉴权是否可达。
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
      headers: {
        ...bearerHeaders(apiKey, true),
        'X-DashScope-Async': 'enable',
      },
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', m ? `/${m}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs?service_type=text
app.get('/', async (c) => {
  const serviceType = c.req.query('service_type')
  let rows = await db.select().from(schema.aiServiceConfigs)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  const parsed = rows.map(withParsedFields)
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()

  // 验证必填字段
  if (!body.service_type || !body.provider) {
    return badRequest(c, '需要 service_type 与 provider')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  let temperature: number | null = null
  if ('temperature' in body) {
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
  }

  let price: number | null
  try { price = parseUnitPrice(body.service_type === 'image' ? body.price_thb_per_image : body.price_thb_per_video_second) }
  catch (err: any) { return badRequest(c, err.message) }
  const configSettings: Record<string, any> = {}
  if (temperature !== null) configSettings.temperature = temperature
  if (price !== null && body.service_type === 'image') configSettings.price_thb_per_image = price
  if (price !== null && body.service_type === 'video') configSettings.price_thb_per_video_second = price

  // unsloth (local): ราคาต่อวินาที = 0 อัตโนมัติ (ไม่งั้น budget guard บล็อก "Set a price…")
  // + settings default ตาม docs/unsloth/PLAN.md ข้อ 3 (ค่าที่ผู้ใช้ส่งมามาก่อน default)
  if (body.provider === 'unsloth') {
    const isUnslothVideo = body.service_type === 'video'
    if (isUnslothVideo && configSettings.price_thb_per_video_second === undefined) {
      configSettings.price_thb_per_video_second = 0
    }
    const defaults = isUnslothVideo
      ? { steps: 20, quality: 'fast', max_concurrent: 1, queue_timeout_minutes: 240 }
      : {}
    const provided = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {}
    for (const [key, value] of Object.entries({ ...defaults, ...provided })) {
      if (configSettings[key] === undefined) configSettings[key] = value
    }
  }

  const res = await db.insert(schema.aiServiceConfigs).values({
    serviceType: body.service_type,
    provider: body.provider,
    name: body.name || `${body.provider}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    settings: Object.keys(configSettings).length ? JSON.stringify(configSettings) : null,
    createdAt: ts,
    updatedAt: ts,
  })

  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, getInsertId(res)))

  return created(c, withParsedFields(row))
})

/** unsloth (local): text = list models + chat สั้น + tool-call · video = เชื่อมต่อ + video/status + ไฟล์ gguf (ไม่สร้างวิดีโอ) */
async function runUnslothTest(serviceType: string, baseUrl: string, apiKey: string | undefined, model: string | undefined, settings: Record<string, any>) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const startedAt = Date.now()
  const result: Record<string, any> = {
    ok: false,
    reachable: false,
    method: 'GET',
    url: redactUrl(joinProviderUrl(baseUrl, '/v1', '')),
    provider: 'unsloth',
    service_type: serviceType,
  }

  const fail = (message: string, code?: string) => {
    result.message = message
    result.latencyMs = Date.now() - startedAt
    if (code) result.errorCode = code
    return result
  }

  let statusResp: Response
  try {
    statusResp = await fetch(joinProviderUrl(baseUrl, '/v1', '/models'), { headers, signal: AbortSignal.timeout(15_000) })
  } catch (error: any) {
    return fail(`เชื่อมต่อ Unsloth server (${redactUrl(baseUrl)}) ไม่ได้: ${error?.message || 'network error'}`, 'E_LOCAL_PROVIDER_UNREACHABLE')
  }
  result.status = statusResp.status
  if (statusResp.status === 401 || statusResp.status === 403) {
    return fail(`Unsloth server ปฏิเสธ API key (HTTP ${statusResp.status})`, 'E_LOCAL_PROVIDER_UNREACHABLE')
  }
  if (!statusResp.ok) {
    return fail(`Unsloth server ตอบ HTTP ${statusResp.status} — ตรวจ Base URL (ต้องเป็น root เช่น http://127.0.0.1:8888)`)
  }
  result.reachable = true

  if (serviceType === 'video') {
    // video/status: loaded/defaults/presets + ตรวจว่าไฟล์ gguf ดาวน์โหลดไว้ในเครื่องหรือยัง
    let videoStatus: any
    try {
      const resp = await fetch(joinProviderUrl(baseUrl, '/api/inference', '/video/status'), { headers, signal: AbortSignal.timeout(15_000) })
      if (!resp.ok) return fail(`video/status ตอบ HTTP ${resp.status}`, 'E_LOCAL_PROVIDER_UNREACHABLE')
      videoStatus = await resp.json()
    } catch (error: any) {
      return fail(`เรียก video/status ไม่สำเร็จ: ${error?.message || 'network error'}`, 'E_LOCAL_PROVIDER_UNREACHABLE')
    }
    const ggufFilename = typeof settings.gguf_filename === 'string' && settings.gguf_filename.trim()
      ? settings.gguf_filename.trim()
      : 'minimax_h3_fl2va_pruned-Q8_0.gguf'
    let ggufDownloaded: boolean | null = null
    try {
      const repo = videoStatus?.repo_id || model || 'unsloth/MiniMax-H3-GGUF'
      // joinProviderUrl ใส่ query ใน path ไม่ได้ (pathname setter จะ escape '?') — ต่อ searchParams เอง
      const variantsUrl = new URL(joinProviderUrl(baseUrl, '/api/models', '/gguf-variants'))
      variantsUrl.searchParams.set('repo_id', repo)
      const variantsResp = await fetch(variantsUrl, { headers, signal: AbortSignal.timeout(15_000) })
      if (variantsResp.ok) {
        const variants = (await variantsResp.json() as any)?.variants
        if (Array.isArray(variants)) {
          ggufDownloaded = variants.some((v: any) => v?.filename === ggufFilename && v?.downloaded)
        }
      }
    } catch { /* ตรวจไฟล์ไม่ได้ → null (ไม่ถือว่า fail) */ }
    const defaults = videoStatus?.defaults || {}
    result.ok = true
    result.model = videoStatus?.repo_id || model || null
    result.loaded = !!videoStatus?.loaded
    result.gguf_downloaded = ggufDownloaded
    if (ggufDownloaded === false) result.errorCode = 'E_LOCAL_MODEL_NOT_DOWNLOADED'
    result.message = videoStatus?.loaded
      ? `โมเดลวิดีโอโหลดอยู่ (${videoStatus.repo_id}) · ไฟล์ ${ggufFilename} ${ggufDownloaded === false ? 'ยังไม่ถูกดาวน์โหลด' : 'พร้อม'}`
      : 'เชื่อมต่อสำเร็จ — โมเดลวิดีโอยังไม่โหลด (ระบบจะโหลดให้เองตอนสร้างงานแรก)'
    result.capabilities = {
      family: videoStatus?.family ?? null,
      has_audio: !!videoStatus?.has_audio,
      supports_keyframes: !!videoStatus?.supports_keyframes,
      supports_references: !!videoStatus?.supports_references,
      fps: defaults.fps ?? null,
      frame_step: defaults.frame_step ?? null,
      frame_offset: defaults.frame_offset ?? null,
      min_num_frames: defaults.num_frames ?? null,
      duration_presets: defaults.duration_presets ?? null,
      resolution_presets: defaults.resolution_presets ?? null,
    }
    result.latencyMs = Date.now() - startedAt
    return result
  }

  // text: (1) รายการโมเดล (2) chat ข้อความสั้น (3) tool-call ด้วย tool จำลอง
  let models: any
  try {
    models = await statusResp.json()
  } catch {
    return fail('GET /v1/models คืนรูปแบบไม่ถูกต้อง')
  }
  const modelList = Array.isArray(models?.data) ? models.data.map((m: any) => m?.id).filter(Boolean) : []
  result.model = model || modelList[0] || null
  // loaded = โมเดลที่ระบุโหลดอยู่จริงบน server (จาก /v1/models ของ unsloth เอง)
  const modelEntry = Array.isArray(models?.data) && result.model
    ? models.data.find((m: any) => m?.id && String(m.id) === String(result.model))
    : null
  result.loaded = modelEntry ? !!modelEntry.loaded : null
  result.models = modelList.slice(0, 10)
  if (!result.model) return fail('ไม่พบโมเดลข้อความบน Unsloth server — โหลดโมเดลในหน้า UI ของ Unsloth ก่อน')

  const chatUrl = joinProviderUrl(baseUrl, '/v1', '/chat/completions')
  result.url = redactUrl(chatUrl)
  result.method = 'POST'
  let chatOk = false
  try {
    const chatResp = await fetch(chatUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: result.model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], stream: false, max_tokens: 16 }),
      signal: AbortSignal.timeout(120_000),
    })
    result.status = chatResp.status
    if (!chatResp.ok) {
      const text = (await chatResp.text()).slice(0, 200)
      return fail(`chat/completions ตอบ HTTP ${chatResp.status} ${text}`, chatResp.status === 401 || chatResp.status === 403 ? 'E_LOCAL_PROVIDER_UNREACHABLE' : undefined)
    }
    const chat = await chatResp.json()
    chatOk = Boolean(chat?.choices?.[0]?.message)
    result.chat_ok = chatOk
    result.response_preview = String(chat?.choices?.[0]?.message?.content || '').slice(0, 120)
  } catch (error: any) {
    return fail(`chat/completions ล้มเหลว: ${error?.message || 'network error'}`, 'E_LOCAL_PROVIDER_UNREACHABLE')
  }

  // tool-call: tool จำลอง 1 ตัว — โมเดลบน llama.cpp ต้องเลือกเรียกเองได้
  let toolCallOk = false
  try {
    const toolResp = await fetch(chatUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: result.model,
        messages: [{ role: 'user', content: 'What is the weather in Tokyo right now? You must use the get_weather tool to answer.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a city',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string', description: 'City name' } },
              required: ['city'],
            },
          },
        }],
        tool_choice: 'auto',
        stream: false,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (toolResp.ok) {
      const toolResult = await toolResp.json()
      toolCallOk = Array.isArray(toolResult?.choices?.[0]?.message?.tool_calls) && toolResult.choices[0].message.tool_calls.length > 0
    }
  } catch { /* tool-call probe ล้มเหลว = toolCallOk false */ }
  result.toolCallOk = toolCallOk
  result.ok = chatOk
  result.message = chatOk
    ? (toolCallOk
      ? `เชื่อมต่อสำเร็จ · chat ได้ · tool calling ได้ (${result.model})`
      : `เชื่อมต่อสำเร็จ · chat ได้ · แต่ tool calling ไม่สำเร็จ — Agent บางตัวอาจทำงานไม่ครบ (${result.model})`)
    : 'เชื่อมต่อสำเร็จ แต่ chat/completions ไม่ตอบตามรูปแบบที่คาด'
  result.latencyMs = Date.now() - startedAt
  return result
}

/** settings จาก request body ของ /test (payload อาจแนบ settings มาด้วย) */
function parseTestSettings(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>
  return {}
}

// POST /ai-configs/test
app.post('/test', async (c) => {
  const body = await c.req.json()
  if (body.config_id && !body.api_key) {
    const [saved] = await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.id, Number(body.config_id)))
    if (!saved) return notFound(c)
    if (saved.serviceType !== body.service_type || saved.provider !== body.provider || saved.baseUrl !== body.base_url) {
      return badRequest(c, 'การตั้งค่าที่ทดสอบไม่ตรงกับรายการที่บันทึก')
    }
    body.api_key = saved.apiKey
    // ทดสอบด้วย config ที่บันทึกไว้ → ใช้ settings ที่บันทึกไว้ด้วย (เช่น gguf_filename ของ unsloth)
    if (body.settings === undefined) {
      try { body.settings = saved.settings ? JSON.parse(saved.settings) : undefined } catch { /* legacy settings */ }
    }
  }
  if (!body.service_type || !body.provider || !body.base_url) {
    return badRequest(c, '需要 service_type、provider 与 base_url')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model

  if (body.provider === 'unsloth') {
    // unsloth: ทดสอบหลายขั้น (text = models+chat+tool-call · video = status+gguf) — provider อื่นใช้ probe เดิม
    const payload = await runUnslothTest(body.service_type, body.base_url, body.api_key, model, parseTestSettings(body.settings))
    const logAction = payload.ok ? 'probe-done' : 'probe-unexpected'
    if (payload.ok) logTaskSuccess('AIConfig', logAction, { provider: 'unsloth', status: payload.status, serviceType: body.service_type })
    else logTaskError('AIConfig', logAction, { provider: 'unsloth', status: payload.status, serviceType: body.service_type, errorCode: payload.errorCode })
    return success(c, payload)
  }

  const probe = buildProbe(body.service_type, body.provider, body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    const payload = {
      ok: resp.ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: reachable
        ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
        : '端点未按预期响应，请检查 Base URL 和代理前缀',
      response_preview: (body.api_key ? text.replaceAll(String(body.api_key), '[redacted]') : text).slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
      url: probeUrl,
      message: (body.api_key ? String(error.message || '请求失败').replaceAll(String(body.api_key), '[redacted]') : error.message || '请求失败'),
      response_preview: '',
    })
  }
})

// GET /ai-configs/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row) return notFound(c)
  return success(c, withParsedFields(row))
})

// PUT /ai-configs/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [existing] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!existing) return notFound(c)

  const serviceType = 'service_type' in body ? body.service_type : existing.serviceType
  const provider = 'provider' in body ? body.provider : existing.provider
  if (!isOfficialProvider(serviceType, provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  const updates: Record<string, any> = { updatedAt: now() }

  if ('service_type' in body) updates.serviceType = body.service_type
  if ('provider' in body) updates.provider = body.provider
  if ('name' in body) updates.name = body.name
  if ('base_url' in body) updates.baseUrl = body.base_url
  if (typeof body.api_key === 'string' && body.api_key.trim()) updates.apiKey = body.api_key.trim()
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('priority' in body) updates.priority = body.priority
  if ('is_active' in body) updates.isActive = body.is_active
  if ('temperature' in body) {
    let temperature: number | null
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
    // 与已有 settings 合并，清空的 temperature 从 JSON 中移除
    let settings: Record<string, any> = {}
    try { settings = existing.settings ? JSON.parse(existing.settings) : {} } catch { settings = {} }
    if (temperature === null) delete settings.temperature
    else settings.temperature = temperature
    updates.settings = Object.keys(settings).length ? JSON.stringify(settings) : null
  }

  if ('price_thb_per_image' in body || 'price_thb_per_video_second' in body) {
    let settings: Record<string, any> = {}
    try { settings = (updates.settings ?? existing.settings) ? JSON.parse(updates.settings ?? existing.settings) : {} } catch { settings = {} }
    for (const key of ['price_thb_per_image', 'price_thb_per_video_second'] as const) {
      if (!(key in body)) continue
      try {
        const price = parseUnitPrice(body[key])
        if (price === null) delete settings[key]
        else settings[key] = price
      } catch (err: any) { return badRequest(c, err.message) }
    }
    updates.settings = Object.keys(settings).length ? JSON.stringify(settings) : null
  }

  // unsloth: แก้ settings เฉพาะที่ (steps/quality/max_concurrent/queue_timeout_minutes/gguf_filename)
  const effectiveProvider = ('provider' in body ? body.provider : existing.provider) === 'unsloth'
  if (effectiveProvider && body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
    const allowed = ['steps', 'quality', 'max_concurrent', 'queue_timeout_minutes', 'gguf_filename'] as const
    let settings: Record<string, any> = {}
    try { settings = (updates.settings ?? existing.settings) ? JSON.parse(updates.settings ?? existing.settings) : {} } catch { settings = {} }
    for (const key of allowed) {
      if (!(key in body.settings)) continue
      if (body.settings[key] === null) delete settings[key]
      else settings[key] = body.settings[key]
    }
    updates.settings = Object.keys(settings).length ? JSON.stringify(settings) : null
  }

  await db.update(schema.aiServiceConfigs).set(updates).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// DELETE /ai-configs/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// GET /ai-providers
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const rows = await db.select().from(schema.aiServiceProviders)
  const parsed = rows.map(r => ({
    ...toSnakeCase(r),
    preset_models: r.presetModels ? JSON.parse(r.presetModels) : [],
  }))
  return success(c, parsed)
})

export default app
