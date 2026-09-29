/**
 * preload — 渲染进程安全桥
 * 暴露 window.nakaDesktop：目录选择、迁移触发、迁移进度订阅。
 * contextIsolation 默认开启，仅经 contextBridge 暴露白名单方法。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nakaDesktop', {
  /** 弹原生目录选择框；返回 { ok, path?, freeBytes?, error?, canceled? } */
  pickDirectory: () => ipcRenderer.invoke('naka:pick-directory'),
  /** 触发存储迁移；返回 { ok } 或 reject（错误信息见进度事件/异常） */
  startMigration: (opts: { targetDir: string, migrateFiles: boolean }) =>
    ipcRenderer.invoke('naka:start-migration', opts),
  /** 订阅迁移进度；返回取消订阅函数 */
  onMigrateProgress: (cb: (progress: { phase: string, copiedBytes?: number, totalBytes?: number, message?: string }) => void) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress)
    ipcRenderer.on('naka:migrate-progress', listener)
    return () => ipcRenderer.removeListener('naka:migrate-progress', listener)
  },
  // ---- 应用内更新 ----
  getUpdateState: () => ipcRenderer.invoke('naka:update-state'),
  checkUpdate: () => ipcRenderer.invoke('naka:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('naka:update-download'),
  applyUpdate: () => ipcRenderer.invoke('naka:update-apply'),
  /** 订阅更新下载进度（0-100）；返回取消订阅函数 */
  onUpdateProgress: (cb: (percent: number) => void) => {
    const listener = (_event: unknown, percent: number) => cb(percent)
    ipcRenderer.on('naka:update-progress', listener)
    return () => ipcRenderer.removeListener('naka:update-progress', listener)
  },
})
