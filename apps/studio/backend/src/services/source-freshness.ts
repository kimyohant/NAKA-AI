import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

type Snapshot = Record<string, string>

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function sourceSnapshotForShot(storyboardId: number): Snapshot | null {
  const shot = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId)).get()
  if (!shot) return null
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, shot.episodeId)).get()
  if (!episode) return null
  const drama = db.select().from(schema.dramas).where(eq(schema.dramas.id, episode.dramaId)).get()
  const scene = shot.sceneId ? db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.sceneId)).get() : null
  const characterIds = db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId)).all()
    .map(link => link.characterId).sort((a, b) => a - b)
  const characters = characterIds.map(id => db.select().from(schema.characters).where(eq(schema.characters.id, id)).get())
  const lookLinks = db.select().from(schema.storyboardCharacterLooks)
    .where(eq(schema.storyboardCharacterLooks.storyboardId, storyboardId)).all()
    .sort((a, b) => a.characterId - b.characterId)
  const looks = lookLinks.map(link => ({
    characterId: link.characterId,
    look: db.select().from(schema.characterLooks).where(eq(schema.characterLooks.id, link.lookId)).get(),
  }))
  const propIds = db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId)).all()
    .map(link => link.propId).sort((a, b) => a - b)
  const props = propIds.map(id => db.select().from(schema.props).where(eq(schema.props.id, id)).get())

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

export function videoSourceStatus(storyboardId: number, videoPath: string | null) {
  if (!videoPath) return { state: 'missing' as const, changed: [] as string[] }
  const tasks = db.select().from(schema.sysTask).where(eq(schema.sysTask.storyboardId, storyboardId)).all()
  const task = tasks.filter(row => row.type === 'video' && row.status === 'completed' && row.localPath === videoPath)
    .sort((a, b) => b.id - a.id)[0]
  if (!task?.sourceSnapshot) return { state: 'untracked' as const, changed: [] as string[] }
  const current = sourceSnapshotForShot(storyboardId)
  if (!current) return { state: 'untracked' as const, changed: [] as string[] }
  let stored: Snapshot
  try { stored = JSON.parse(task.sourceSnapshot) } catch { return { state: 'untracked' as const, changed: [] as string[] } }
  const changed = Object.keys(current).filter(key => stored[key] !== current[key])
  return { state: changed.length ? 'stale' as const : 'current' as const, changed }
}
