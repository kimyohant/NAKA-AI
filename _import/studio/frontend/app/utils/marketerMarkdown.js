// AI Marketer 文档的极简 Markdown 渲染器（不引入依赖）：
// 支持 标题 / 无序·有序列表 / 粗体·斜体·行内代码 / 表格 / 引用 / 分隔线 / 代码块 / 链接。
// 安全：先整体转义 HTML，再只生成白名单标签；链接仅允许 http(s)。输出用于 v-html。

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ESC[ch])
}

// 行内格式：输入必须是已转义文本
function inline(text) {
  const codes = []
  // 行内代码先占位，内部不再做粗体/链接替换
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
}

function splitRow(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map(c => c.trim())
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const UL_RE = /^\s*[-*+]\s+(.*)$/
const OL_RE = /^\s*\d+[.)]\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/

export function renderMarkdown(src) {
  const lines = escapeHtml(String(src ?? '').replace(/\r\n?/g, '\n')).split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    // 代码块
    if (/^\s*```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++ // 跳过结束围栏（缺失时也安全）
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`)
      continue
    }

    const h = line.match(HEADING_RE)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i++
      continue
    }

    if (HR_RE.test(line)) { out.push('<hr>'); i++; continue }

    // 表格：表头行 + 分隔行
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      const thead = `<thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
      const tbody = rows.length
        ? `<tbody>${rows.map(r => `<tr>${head.map((_, ci) => `<td>${inline(r[ci] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`
        : ''
      out.push(`<div class="md-table"><table>${thead}${tbody}</table></div>`)
      continue
    }

    // 引用（> 已被转义为 &gt;）
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ''))
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`)
      continue
    }

    // 列表（同类型连续行合并；缩进子项按同级展示）
    const ul = line.match(UL_RE)
    const ol = !ul && line.match(OL_RE)
    if (ul || ol) {
      const re = ul ? UL_RE : OL_RE
      const tag = ul ? 'ul' : 'ol'
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(re)
        if (m) { items.push(m[1]); i++; continue }
        // 列表项的续行（缩进文本）
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim()
          i++
          continue
        }
        break
      }
      out.push(`<${tag}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>`)
      continue
    }

    // 段落：连续非空、非块级行
    const buf = []
    while (
      i < lines.length && lines[i].trim()
      && !HEADING_RE.test(lines[i]) && !/^\s*```/.test(lines[i]) && !HR_RE.test(lines[i])
      && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) && !/^\s*&gt;/.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]))
    ) buf.push(lines[i++].trim())
    if (buf.length) out.push(`<p>${buf.map(inline).join('<br>')}</p>`)
    else i++
  }
  return out.join('\n')
}
