/**
 * AI 内容语言指令块 — 按 RequestContext 中的目标语言生成，追加到 Agent instructions 末尾
 *
 * 设计要点：
 * - zh / 未设置时返回空串：默认行为与历史完全一致，零 token 开销
 * - 指令用英文书写（多语言模型遵循度最好），目标语言用原生名标注
 * - 必须自带「最高优先级」声明：桌面版已安装用户的 workspace 模板不会被覆盖
 *   （cpSync force:false），旧 SKILL.md 中的「只输出中文」约束只能靠这里的显式覆盖压制
 */

const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  th: 'ภาษาไทย (Thai)',
  en: 'English',
}

/**
 * กฎอัตราจังหวะเวลาต่อภาษา（Pacing rates）— แก้ปัญหากฎจีน "500字/分钟 / 4.5字/秒"
 * ที่ใช้กับทุกภาษาไม่ได้: ภาษาไทย 1 พยางค์ ≈ 3 ตัวอักษรเขียน, อัตราพูด ≈ 4-5 พยางค์/วินาที
 * คืนค่าว่างสำหรับ zh เพื่อให้กฎเดิมในไฟล์ prompt ทำงานเหมือนเดิม (ไม่มี token overhead)
 */
const PACING_RATES: Record<string, { dialogue: string; episode: string }> = {
  th: {
    dialogue: 'dialogue/narration ≈ 5 syllables per second — in Thai script this is ≈ 14-16 written Thai characters per second (excluding spaces and punctuation; 1 Thai syllable ≈ 3 written characters)',
    episode: 'total spoken content budget ≈ 400-450 written Thai characters per minute of episode',
  },
  en: {
    dialogue: 'dialogue/narration ≈ 2.5 spoken words per second (≈ 150 words per minute)',
    episode: 'total spoken content budget ≈ 130-150 words per minute of episode',
  },
}

export function buildPacingDirective(lang?: string | null): string {
  if (!lang || lang === 'zh') return ''
  const rates = PACING_RATES[lang]
  if (!rates) return ''
  return [
    '## Duration Pacing Rates for the Output Language (HIGHEST PRIORITY)',
    '',
    'When estimating how much spoken content fits into a given duration, do NOT use Chinese character rates. For the output language use these rates:',
    `- Spoken duration: ${rates.dialogue}.`,
    `- Episode budget: ${rates.episode}.`,
    '',
    'These rates OVERRIDE any per-character pacing rules written for Chinese elsewhere in these instructions (e.g. "500字/分钟" or "4.5字/秒"). Keep the structural rules (segment 8-15s, beat boundaries, +2s acting margin) unchanged.',
  ].join('\n')
}

export function buildLanguageDirective(lang?: string | null): string {
  if (!lang || lang === 'zh') return ''
  const native = LANGUAGE_NATIVE_NAMES[lang] || lang
  return [
    '## Output Language (HIGHEST PRIORITY)',
    '',
    `ALL user-facing content you produce (scripts, dialogue, extracted fields, storyboard descriptions, atmosphere, image prompts, video prompts, asset names for NEW assets) MUST be written in ${native}.`,
    '',
    'This instruction has the highest priority and OVERRIDES any conflicting language requirement anywhere else in these instructions or skills — including requirements such as "output must be pure Chinese / 只输出中文". Ignore those.',
    '',
    'Exceptions:',
    '- When referencing EXISTING assets with @mentions (e.g. in video prompts), the name after @ must EXACTLY match the asset name as it appears in the provided asset lists — do NOT translate or rewrite existing asset names.',
    '- The visual style prefix of image prompts is injected automatically by the system (in English). Do not translate, rewrite, or duplicate it.',
  ].join('\n')
}
