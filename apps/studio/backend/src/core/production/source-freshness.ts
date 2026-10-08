import { createHash } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

type Snapshot = Record<string, string>

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function sourceSnapshotForShot(storyboardId: number): Promise<Snapshot | null> {
  const shot = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId)))[0]
  if (!shot) return null
  const [episodeRows, sceneRows, characterLinks, lookRows, propLinks] = await Promise.all([
    db.select().from(schema.episodes).where(eq(schema.episodes.id, shot.episodeId)),
    shot.sceneId ? db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.sceneId)) : [],
    db.select().from(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, storyboardId)),
    db.select().from(schema.storyboardCharacterLooks).where(eq(schema.storyboardCharacterLooks.storyboardId, storyboardId)),
    db.select().from(schema.storyboardProps).where(eq(schema.storyboardProps.storyboardId, storyboardId)),
  ])
  const episode = episodeRows[0]
  if (!episode) return null
  const scene = sceneRows[0] ?? null
  // ids ascending and looks by character: the digests below depend on this order
  const characterIds = characterLinks.map(link => link.characterId).sort((a, b) => a - b)
  const lookLinks = lookRows.sort((a, b) => a.characterId - b.characterId)
  const propIds = propLinks.map(link => link.propId).sort((a, b) => a - b)
  const lookIds = lookLinks.map(link => link.lookId)
  const [dramaRows, characterRows, lookRecords, propRows] = await Promise.all([
    db.select().from(schema.dramas).where(eq(schema.dramas.id, episode.dramaId)),
    characterIds.length ? db.select().from(schema.characters).where(inArray(schema.characters.id, characterIds)) : [],
    lookIds.length ? db.select().from(schema.characterLooks).where(inArray(schema.characterLooks.id, lookIds)) : [],
    propIds.length ? db.select().from(schema.props).where(inArray(schema.props.id, propIds)) : [],
  ])
  const drama = dramaRows[0]
  const byId = <T extends { id: number }>(rows: T[]) => new Map(rows.map(row => [row.id, row]))
  const characterById = byId(characterRows), lookById = byId(lookRecords), propById = byId(propRows)
  const characters = characterIds.map(id => characterById.get(id))
  const looks = lookLinks.map(link => ({ characterId: link.characterId, look: lookById.get(link.lookId) }))
  const props = propIds.map(id => propById.get(id))

  return {
    script: digest([episode.content, episode.scriptContent]),
    style: digest([drama?.style, drama?.aspectRatio, drama?.genre, drama?.metadata, episode.resolution, episode.videoConfigId]),
    shot: digest([shot.sceneId, shot.title, shot.description, shot.location, shot.time, shot.shotType,
      shot.angle, shot.movement, shot.result, shot.atmosphere, shot.imagePrompt, shot.videoPrompt,
      shot.bgmPrompt, shot.soundEffect, shot.duration]),
    scene: digest(scene && [scene.location, scene.time, scene.prompt, scene.lighting, scene.finalPrompt, scene.imageUrl, scene.localPath, scene.deletedAt]),
    characters: digest([characters.map(char => char && [char.id, char.name, char.description, char.appearance,
      char.styling, char.finalPrompt, char.imageUrl, char.referenceImages, char.localPath, char.deletedAt]),
      looks.map(item => [item.characterId, item.look && [item.look.id, item.look.name, item.look.notes, item.look.imageUrl]])]),
    props: digest(props.map(prop => prop && [prop.id, prop.name, prop.type, prop.description,
      prop.prompt, prop.finalPrompt, prop.imageUrl, prop.referenceImages, prop.localPath, prop.deletedAt])),
    references: digest([shot.composedImage, shot.firstFrameImage, shot.lastFrameImage, shot.referenceImages]),
  }
}

export async function videoSourceStatus(storyboardId: number, videoPath: string | null) {
  if (!videoPath) return { state: 'missing' as const, changed: [] as string[] }
  const tasks = await db.select().from(schema.sysTask).where(eq(schema.sysTask.storyboardId, storyboardId))
  const task = tasks.filter(row => row.type === 'video' && row.status === 'completed' && row.localPath === videoPath)
    .sort((a, b) => b.id - a.id)[0]
  if (!task?.sourceSnapshot) return { state: 'untracked' as const, changed: [] as string[] }
  const current = await sourceSnapshotForShot(storyboardId)
  if (!current) return { state: 'untracked' as const, changed: [] as string[] }
  let stored: Snapshot
  try { stored = JSON.parse(task.sourceSnapshot) } catch { return { state: 'untracked' as const, changed: [] as string[] } }
  const changed = Object.keys(current).filter(key => stored[key] !== current[key])
  return { state: changed.length ? 'stale' as const : 'current' as const, changed }
}
