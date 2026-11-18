import fs from 'fs/promises'
import path from 'path'
import { createLogger } from './logger.js'

const logger = createLogger('Cleanup')

// Defaults: keep uploads under 100 GB and delete folders older than 48h.
// Note: Large batch workflows can temporarily exceed this; override via CLEANUP_MAX_TOTAL_MB.
const MAX_TOTAL_MB = parseInt(process.env.CLEANUP_MAX_TOTAL_MB || '102400', 10)
const MAX_AGE_HOURS = parseInt(process.env.CLEANUP_MAX_AGE_HOURS || '48', 10)
const UPLOADS_DIR = path.join(process.cwd(), '..', 'uploads')
const OUTPUTS_DIR = path.join(process.cwd(), '..', 'outputs')

let intervalHandle = null

async function safeStat(p) {
  try {
    return await fs.stat(p)
  } catch {
    return null
  }
}

async function dirSizeBytes(dir) {
  const st = await safeStat(dir)
  if (!st || !st.isDirectory()) return 0
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      total += await dirSizeBytes(full)
    } else {
      const s = await safeStat(full)
      if (s) total += s.size
    }
  }
  return total
}

function hoursSince(mtimeMs) {
  const diffMs = Date.now() - mtimeMs
  return diffMs / 1000 / 3600
}

async function listJobDirs(root) {
  const st = await safeStat(root)
  if (!st || !st.isDirectory()) return []
  const dirs = await fs.readdir(root, { withFileTypes: true })
  const results = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const full = path.join(root, d.name)
    const s = await safeStat(full)
    if (s) results.push({ name: d.name, full, mtimeMs: s.mtimeMs })
  }
  // Sort by newest first
  results.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return results
}

async function removeDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true })
    logger.info(`Removed: ${dir}`)
  } catch (err) {
    logger.warn(`Failed to remove ${dir}: ${err.message}`)
  }
}

async function getInProgressAgeHours(jobDir) {
  const lockPath = path.join(jobDir, '.in_progress')
  const st = await safeStat(lockPath)
  if (!st || !st.isFile()) return null
  return hoursSince(st.mtimeMs)
}

async function cleanupOnce() {
  try {
    // Age-based cleanup first
    for (const root of [UPLOADS_DIR, OUTPUTS_DIR]) {
      const jobs = await listJobDirs(root)
      for (const j of jobs) {
        if (root === UPLOADS_DIR) {
          const inProgressAgeH = await getInProgressAgeHours(j.full)
          if (inProgressAgeH !== null && inProgressAgeH <= MAX_AGE_HOURS) {
            // Don't remove active uploads.
            continue
          }
        }
        const ageH = hoursSince(j.mtimeMs)
        if (ageH > MAX_AGE_HOURS) {
          await removeDir(j.full)
        }
      }
    }

    // Size-based cleanup for uploads
    let totalBytes = await dirSizeBytes(UPLOADS_DIR)
    const maxBytes = MAX_TOTAL_MB * 1024 * 1024
    if (totalBytes > maxBytes) {
      const jobs = await listJobDirs(UPLOADS_DIR)
      // keep newest, remove oldest until under limit
      for (let i = jobs.length - 1; i >= 0 && totalBytes > maxBytes; i -= 1) {
        const j = jobs[i]
        const inProgressAgeH = await getInProgressAgeHours(j.full)
        if (inProgressAgeH !== null && inProgressAgeH <= MAX_AGE_HOURS) {
          // Skip active uploads. If disk pressure remains, operator must raise CLEANUP_MAX_TOTAL_MB
          // or wait for the job to complete.
          continue
        }
        const sizeBefore = await dirSizeBytes(j.full)
        await removeDir(j.full)
        totalBytes -= sizeBefore
      }
    }
  } catch (err) {
    logger.error(`Cleanup error: ${err.message}`)
  }
}

export function startCleanupScheduler() {
  if (intervalHandle) return
  const everyMinutes = parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '30', 10)
  logger.info(`Starting cleanup scheduler every ${everyMinutes} minutes (max ${MAX_TOTAL_MB} MB, age ${MAX_AGE_HOURS}h)`) 
  intervalHandle = setInterval(cleanupOnce, everyMinutes * 60 * 1000)
  // Run once on start after slight delay to not compete with boot
  setTimeout(cleanupOnce, 10 * 1000)
}

export function stopCleanupScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    logger.info('Stopped cleanup scheduler')
  }
}

export async function runCleanupNow() {
  await cleanupOnce()
}
