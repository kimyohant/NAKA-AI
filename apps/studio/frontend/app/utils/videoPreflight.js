// Keep the reference order and @name mapping in one place for preview and submission.
export function analyzeVideoShot({ prompt = '', assets = [], limit = 9, duration = 10 }) {
  const references = []
  const byUrl = new Map()
  const byName = new Map()
  const issues = []
  const assetPlan = assets.map(asset => {
    const name = String(asset.name || '').trim()
    const url = String(asset.url || '').trim()
    if (!url) {
      issues.push({ code: 'missingImage', name })
      return { ...asset, name, url, index: null }
    }
    let index = byUrl.get(url)
    if (!index) {
      index = references.length + 1
      references.push(url)
      byUrl.set(url, index)
    }
    if (name) {
      const previous = byName.get(name)
      if (previous && previous !== index) issues.push({ code: 'ambiguousName', name })
      else byName.set(name, index)
    }
    return { ...asset, name, url, index }
  })

  if (references.length > limit) issues.push({ code: 'tooManyImages', count: references.length, limit })
  const seconds = Number(duration)
  if (!Number.isFinite(seconds) || seconds < 2 || seconds > 30) issues.push({ code: 'invalidDuration' })

  const rawPrompt = String(prompt || '').trim()
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  const resolvedPrompt = rawPrompt.replace(/@([^\s@，。,.!?;；:：()（）\[\]【】]+)/g, (match, token) => {
    const numbered = token.match(/^图片(\d+)/)
    if (numbered) {
      const index = Number(numbered[1])
      if (index < 1 || index > references.length) issues.push({ code: 'invalidIndex', name: token })
      return match
    }
    const name = names.find(candidate => token.startsWith(candidate))
    if (!name) {
      issues.push({ code: 'unboundMention', name: token })
      return match
    }
    return `@图片${byName.get(name)}${name}${token.slice(name.length)}`
  })

  if (!rawPrompt && !references.length) issues.push({ code: 'emptyInput' })
  return { references, assetPlan, resolvedPrompt, issues }
}
