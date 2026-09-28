import type { Context } from 'hono'

export function success(c: Context, data: any = null) {
  return c.json({ code: 200, data, message: 'success' })
}

export function created(c: Context, data: any = null) {
  return c.json({ code: 201, data, message: 'created' }, 201)
}

/**
 * AppError — 携带稳定错误码的业务错误（E_NO_TEXT_MODEL 等），
 * 路由层 catch 后经 badRequest(c, msg, err.errorCode) 下发 errorCode，
 * 前端按 errors.codes.<code> 显示本地化文案，message 仅作兜底/日志
 */
export class AppError extends Error {
  errorCode: string
  constructor(message: string, errorCode: string) {
    super(message)
    this.errorCode = errorCode
  }
}

function withErrorCode(body: { code: number; message: string }, errorCode?: string) {
  return errorCode ? { ...body, errorCode } : body
}

export function badRequest(c: Context, message = '请求参数错误', errorCode?: string) {
  return c.json(withErrorCode({ code: 400, message }, errorCode), 400)
}

export function notFound(c: Context, message = '资源不存在', errorCode?: string) {
  return c.json(withErrorCode({ code: 404, message }, errorCode), 404)
}

export function serverError(c: Context, message = '服务器内部错误', errorCode?: string) {
  return c.json(withErrorCode({ code: 500, message }, errorCode), 500)
}

export function now() {
  return new Date().toISOString()
}
