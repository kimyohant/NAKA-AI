import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export type BillableType = 'image' | 'video'

function settingsObject(raw: string | null): Record<string, unknown> {
  try {
    const value = raw ? JSON.parse(raw) : null
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export function parseUnitPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const price = Number(raw)
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw new Error('Price must be between 0 and 1,000,000 THB')
  return price
}

export function estimateCostThb(settings: string | null, type: BillableType, duration?: number): number | null {
  const values = settingsObject(settings)
  const price = parseUnitPrice(type === 'image' ? values.price_thb_per_image : values.price_thb_per_video_second)
  if (price === null) return null
  const units = type === 'image' ? 1 : Number(duration)
  if (!Number.isFinite(units) || units <= 0) return null
  return Math.ceil(price * units * 100) / 100
}

export async function budgetForDrama(dramaId: number) {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) throw new Error('Project not found')
  const tasks = await db.select().from(schema.sysTask).where(eq(schema.sysTask.dramaId, dramaId))
  const estimatedTotalThb = Math.round(tasks.reduce((sum, task) => sum + (task.estimatedCostThb || 0), 0) * 100) / 100
  const unpricedTasks = tasks.filter(task => task.estimatedCostThb == null).length
  return {
    budget_thb: drama.budgetThb,
    estimated_total_thb: estimatedTotalThb,
    remaining_thb: drama.budgetThb == null ? null : Math.round((drama.budgetThb - estimatedTotalThb) * 100) / 100,
    unpriced_tasks: unpricedTasks,
  }
}

export async function quoteGeneration(dramaId: number | undefined, configId: number | undefined, type: BillableType, duration?: number) {
  const config = configId ? (await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId)))[0] : null
  const estimatedCostThb = estimateCostThb(config?.settings || null, type, duration)
  const budget = dramaId ? await budgetForDrama(dramaId) : null
  return {
    estimated_cost_thb: estimatedCostThb,
    ...budget,
    within_budget: budget?.budget_thb == null || (estimatedCostThb !== null && estimatedCostThb <= (budget.remaining_thb ?? 0)),
  }
}

export function validateBudgetQuote(quote: Awaited<ReturnType<typeof quoteGeneration>>) {
  if (quote.budget_thb == null) return
  if (quote.estimated_cost_thb === null) throw new Error('Set a price for this AI configuration before generating within a project budget')
  if (!quote.within_budget) throw new Error(`Project budget exceeded. Remaining estimate: ฿${Math.max(0, quote.remaining_thb ?? 0).toFixed(2)}`)
}
