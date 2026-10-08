/**
 * Per-member data (unified system, step 2).
 *
 * Mounted on /api/v1/* after requireSession:
 *   1. runs the rest of the request inside the member's owner scope (owner-context.ts) — new rows get
 *      owner_user_id from it, list services filter by it;
 *   2. checks every resource id the request names — path segments (/dramas/12, /studio/projects/3/images/9)
 *      and parent ids in the query string / JSON body (drama_id, episode_id, campaignId, …) — and answers
 *      404 E_FORBIDDEN_OWNER when one belongs to another member.
 *
 * Only top-level rows carry owner_user_id; children resolve through their parent (episode → drama, …).
 * Admins may open anything; with SSO off everyone is the 'local' admin, so nothing changes.
 */
import type { Context, Next } from 'hono'
import { db } from '../db/index.js'
import { LOCAL_OWNER, canAccessOwner, runAsOwner } from './owner-context.js'
import { userOf, TOKEN_ADMIN } from './naka-sso.js'

type Kind =
  | 'drama' | 'episode' | 'storyboard' | 'character' | 'scene' | 'prop' | 'look' | 'task'
  | 'campaign' | 'creative' | 'adReference' | 'visual' | 'doc' | 'revision'
  | 'studioProject' | 'studioImage' | 'avatar' | 'influencer' | 'influencerContent'
  | 'cloneProject' | 'cloneVariant' | 'sellerPost'

const DRAMA = 'SELECT owner_user_id AS owner FROM dramas WHERE id = ?'
const viaDrama = (table: string) =>
  `SELECT d.owner_user_id AS owner FROM ${table} x JOIN dramas d ON d.id = x.drama_id WHERE x.id = ?`
const viaCampaign = (table: string) =>
  `SELECT p.owner_user_id AS owner FROM ${table} x JOIN campaigns p ON p.id = x.campaign_id WHERE x.id = ?`
const own = (table: string) => `SELECT owner_user_id AS owner FROM ${table} WHERE id = ?`

const OWNER_SQL: Record<Kind, string> = {
  drama: DRAMA,
  episode: viaDrama('episodes'),
  storyboard: `SELECT d.owner_user_id AS owner FROM storyboards s JOIN episodes e ON e.id = s.episode_id
    JOIN dramas d ON d.id = e.drama_id WHERE s.id = ?`,
  character: viaDrama('characters'),
  scene: viaDrama('scenes'),
  prop: viaDrama('props'),
  look: `SELECT d.owner_user_id AS owner FROM character_looks l JOIN characters c ON c.id = l.character_id
    JOIN dramas d ON d.id = c.drama_id WHERE l.id = ?`,
  task: own('sys_task'),
  campaign: own('campaigns'),
  creative: viaCampaign('campaign_creatives'),
  adReference: viaCampaign('campaign_ad_references'),
  visual: viaCampaign('campaign_visuals'),
  doc: viaCampaign('campaign_docs'),
  revision: `SELECT p.owner_user_id AS owner FROM campaign_doc_revisions r JOIN campaign_docs x ON x.id = r.doc_id
    JOIN campaigns p ON p.id = x.campaign_id WHERE r.id = ?`,
  studioProject: own('studio_projects'),
  studioImage: `SELECT p.owner_user_id AS owner FROM studio_images x JOIN studio_projects p ON p.id = x.project_id WHERE x.id = ?`,
  avatar: own('studio_avatars'),
  influencer: own('studio_influencers'),
  influencerContent: `SELECT p.owner_user_id AS owner FROM studio_influencer_contents x
    JOIN studio_influencers p ON p.id = x.influencer_id WHERE x.id = ?`,
  cloneProject: own('clone_projects'),
  cloneVariant: `SELECT p.owner_user_id AS owner FROM clone_variants x JOIN clone_projects p ON p.id = x.project_id WHERE x.id = ?`,
  sellerPost: own('seller_posts'),
}

/** path segment → kind, per top-level route (/api/v1/<route>/…) */
const PATH_KINDS: Record<string, Record<string, Kind>> = {
  dramas: { dramas: 'drama' },
  episodes: { episodes: 'episode' },
  storyboards: { storyboards: 'storyboard', 'character-looks': 'character' },
  characters: { characters: 'character', looks: 'look' },
  scenes: { scenes: 'scene' },
  props: { props: 'prop' },
  tasks: { tasks: 'task' },
  merge: { episodes: 'episode' },
  campaigns: {
    campaigns: 'campaign', references: 'adReference', visuals: 'visual', docs: 'doc', revisions: 'revision', creatives: 'creative',
  },
  gallery: { creatives: 'creative' },
  studio: {
    projects: 'studioProject', images: 'studioImage', avatars: 'avatar', influencers: 'influencer', contents: 'influencerContent',
  },
  clone: { projects: 'cloneProject', variants: 'cloneVariant' },
  seller: { posts: 'sellerPost' },
}

/** parent ids named in the query string or JSON body */
const PARAM_KINDS: Record<string, Kind> = {
  drama_id: 'drama', dramaId: 'drama',
  episode_id: 'episode', episodeId: 'episode',
  storyboard_id: 'storyboard', storyboardId: 'storyboard', storyboard_ids: 'storyboard',
  character_id: 'character', characterId: 'character', character_ids: 'character',
  scene_id: 'scene', sceneId: 'scene', scene_ids: 'scene',
  prop_id: 'prop', propId: 'prop', prop_ids: 'prop',
  look_id: 'look', lookId: 'look',
  campaign_id: 'campaign', campaignId: 'campaign', sourceCampaignId: 'campaign',
  creativeId: 'creative', creative_id: 'creative',
  avatarId: 'avatar', avatar_id: 'avatar',
  influencerId: 'influencer', influencer_id: 'influencer',
  studioProjectId: 'studioProject', studio_project_id: 'studioProject',
}

/** owner of one row; undefined when the row does not exist (the route answers its own 404) */
export function ownerOf(kind: Kind, id: number): string | undefined {
  const row = db.$client.prepare(OWNER_SQL[kind]).get(id) as { owner: string } | undefined
  return row?.owner
}

const asId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** every (kind, id) the request refers to */
export async function referencedIds(c: Context): Promise<Array<[Kind, number]>> {
  const out: Array<[Kind, number]> = []
  const segments = c.req.path.replace(/^\/api\/v1\//, '').split('/').filter(Boolean)
  const kinds = PATH_KINDS[segments[0]]
  if (kinds) {
    for (let i = 0; i < segments.length - 1; i++) {
      const kind = kinds[segments[i]]
      const id = kind && asId(segments[i + 1])
      if (kind && id) out.push([kind, id])
    }
  }
  const take = (key: string, value: unknown) => {
    const kind = PARAM_KINDS[key]
    if (!kind) return
    for (const v of Array.isArray(value) ? value : [value]) {
      const id = asId(v)
      if (id) out.push([kind, id])
    }
  }
  for (const [key, values] of Object.entries(c.req.queries())) take(key, values)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && (c.req.header('Content-Type') || '').includes('application/json')) {
    // Hono caches the parsed body, so the route can still read it
    const body = await c.req.json().catch(() => null)
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      for (const [key, value] of Object.entries(body)) take(key, value)
    }
  }
  return out
}

/** the owner new rows get: the member's id; the back-office token and single-user mode both write as 'local' */
export const ownerIdFor = (userId: string) => (userId === TOKEN_ADMIN.id ? LOCAL_OWNER : userId)

export async function ownership(c: Context, next: Next) {
  // signed-out calls only reach the open paths (health, sign-in) — no member scope there
  if (!c.get('user' as never)) return next()
  const user = userOf(c)
  return runAsOwner({ ownerId: ownerIdFor(user.id), admin: user.admin }, async () => {
    if (!user.admin) {
      for (const [kind, id] of await referencedIds(c)) {
        const owner = ownerOf(kind, id)
        if (owner !== undefined && !canAccessOwner(owner)) {
          return c.json({ code: 404, message: 'ไม่พบข้อมูล หรือไม่ใช่ของบัญชีนี้', errorCode: 'E_FORBIDDEN_OWNER' }, 404)
        }
      }
    }
    await next()
  })
}
