/**
 * i18n 实例（模块级单例）
 * - 实例放独立模块而非插件内：useAgent/useMigrateState 等 setup 外代码
 *   需要 `import { i18n }` 直接用 i18n.global.t
 * - ssr:false，模块顶层读 localStorage 安全；UI 语言偏好持久化 huobao:locale
 * - legacy:false 必须显式，否则 global.locale 不是 ref 无法运行时切换
 */
import { createI18n } from 'vue-i18n'
import th from '../locales/th.json'
import en from '../locales/en.json'

export const LOCALE_STORAGE_KEY = 'huobao:locale'

export type UiLocale = 'th' | 'en'

export const UI_LOCALES: Array<{ value: UiLocale; label: string }> = [
  { value: 'th', label: 'ไทย' },
  { value: 'en', label: 'English' },
]

export function readStoredLocale(): UiLocale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (v && UI_LOCALES.some(l => l.value === v)) return v as UiLocale
  } catch { /* localStorage 不可用时回退默认 */ }
  return 'th'
}

export function persistLocale(locale: UiLocale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch { /* 忽略持久化失败 */ }
}

export const i18n = createI18n({
  legacy: false,
  locale: readStoredLocale(),
  fallbackLocale: 'en',
  messages: { th, en },
  missingWarn: false,
  fallbackWarn: false,
})

/** 切换 UI 语言并持久化（LocaleSwitcher 与初始化共用） */
export function setUiLocale(locale: UiLocale) {
  i18n.global.locale.value = locale
  persistLocale(locale)
}
