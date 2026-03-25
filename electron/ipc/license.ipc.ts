/**
 * License IPC — AuraSplit v3 (4-Layer Protection)
 *
 * Layer 1: HWID Binding (PowerShell CIM — UUID + CPU + Volume)
 * Layer 2: Cloud Verify (Render server — activate + heartbeat)
 * Layer 3: Offline Cache (AES-256-GCM, 7-day grace, HWID-derived key)
 * Layer 4: Anti-tamper (timestamp validation, cache integrity)
 *
 * Cracker perspective: To bypass, attacker would need to:
 * 1. Patch HWID collection → but it's computed from 3 hardware sources
 * 2. Mock server response → but cache is AES-encrypted with HWID key
 * 3. Modify cache file → but GCM auth tag will fail
 * 4. Time-travel cache → but we check monotonic time consistency
 * 5. Disable check → needs asar unpack + code modification
 */

import { ipcMain, app } from 'electron'
import { execSync } from 'child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ── Obfuscated server URL (XOR with key 0xAB) ──
// Cracker note: plain string grep won't find the URL
const _U = [
  0xc3, 0xdf, 0xdf, 0xdb, 0xd8, 0x91, 0x84, 0x84, 0xca, 0xde,
  0xd9, 0xca, 0xd8, 0xdb, 0xc7, 0xc2, 0xdf, 0x86, 0xc7, 0xc2,
  0xc8, 0xce, 0xc5, 0xd8, 0xce, 0x86, 0xd8, 0xce, 0xd9, 0xdd,
  0xce, 0xd9, 0x85, 0xc4, 0xc5, 0xd9, 0xce, 0xc5, 0xcf, 0xce,
  0xd9, 0x85, 0xc8, 0xc4, 0xc6, 0x84, 0xca, 0xdb, 0xc2
]
function _d(): string {
  return _U.map(b => String.fromCharCode(b ^ 0xAB)).join('')
}

// ── Constants ──
const CACHE_FILE = 'aura_license.dat'
const GRACE_DAYS = 7
const HEARTBEAT_MS = 60_000 // 60 seconds
const APP_SALT = 'AuraSplit_v3_2026_PRO'

// ── State ──
let _cachedHWID: string | null = null
let _heartbeatTimer: NodeJS.Timeout | null = null

// ══════════════════════════════════════════════════
// LAYER 1: HWID Collection
// ══════════════════════════════════════════════════

function getHWID(): string {
  if (_cachedHWID) return _cachedHWID

  const run = (cmd: string): string => {
    try {
      return execSync(cmd, {
        encoding: 'utf-8',
        timeout: 8000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch { return '' }
  }

  // 3 hardware anchors — cracker needs to spoof ALL 3
  const uuid = run('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"')
  const cpu = run('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).ProcessorId"')
  const vol = run('powershell -NoProfile -Command "(Get-CimInstance Win32_LogicalDisk -Filter \\\"DeviceID=\'C:\'\\\" ).VolumeSerialNumber"')

  if (!uuid && !cpu && !vol) {
    // Fallback: use machine name + user (weaker but still unique)
    const fallback = `${process.env.COMPUTERNAME || 'unknown'}-${process.env.USERNAME || 'user'}`
    _cachedHWID = crypto.createHash('sha256').update(fallback + APP_SALT).digest('hex').slice(0, 32)
    return _cachedHWID
  }

  // Hash: SHA-256(UUID|CPU|VOL|SALT) → 32-char hex
  const raw = `${uuid}|${cpu}|${vol}|${APP_SALT}`
  _cachedHWID = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
  return _cachedHWID
}

// ══════════════════════════════════════════════════
// LAYER 3: AES-256-GCM Encrypted Offline Cache
// ══════════════════════════════════════════════════

interface CacheData {
  key: string           // license key
  hwid: string          // bound HWID
  expires: string       // 'LIFETIME' or 'YYYY-MM-DD'
  lastVerified: number  // Unix timestamp ms
  lastBoot: number      // Anti-rewind check
}

function getCachePath(): string {
  const appData = app.getPath('userData')
  return path.join(appData, CACHE_FILE)
}

function deriveKey(hwid: string): Buffer {
  // AES key = SHA-256(HWID + APP_SALT) → 32 bytes
  return crypto.createHash('sha256').update(hwid + APP_SALT + 'AES_KEY').digest()
}

function encryptCache(data: CacheData, hwid: string): Buffer {
  const key = deriveKey(hwid)
  const iv = crypto.randomBytes(12) // GCM uses 12-byte IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const json = JSON.stringify(data)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag() // 16 bytes
  // Format: [IV:12][TAG:16][ENCRYPTED:...]
  return Buffer.concat([iv, tag, encrypted])
}

function decryptCache(hwid: string): CacheData | null {
  try {
    const cachePath = getCachePath()
    if (!fs.existsSync(cachePath)) return null

    const raw = fs.readFileSync(cachePath)
    if (raw.length < 28) return null // minimum: 12 IV + 16 TAG

    const key = deriveKey(hwid)
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const encrypted = raw.subarray(28)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return JSON.parse(decrypted.toString('utf8'))
  } catch {
    // Tampered cache or wrong HWID → fail
    return null
  }
}

function saveCache(data: CacheData): void {
  try {
    const encrypted = encryptCache(data, data.hwid)
    fs.writeFileSync(getCachePath(), encrypted)
  } catch { /* silent */ }
}

function deleteCache(): void {
  try { fs.unlinkSync(getCachePath()) } catch { /* */ }
}

// ══════════════════════════════════════════════════
// LAYER 2: Cloud Verification
// ══════════════════════════════════════════════════

async function serverActivate(key: string, hwid: string): Promise<{ success: boolean; message: string; expires?: string }> {
  try {
    const url = _d() // decode server URL
    const resp = await fetch(`${url}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid }),
      signal: AbortSignal.timeout(10_000),
    })
    return await resp.json()
  } catch {
    return { success: false, message: 'Không thể kết nối server. Kiểm tra internet.' }
  }
}

async function serverVerify(key: string, hwid: string): Promise<{ valid: boolean; message: string; expires?: string }> {
  try {
    const url = _d()
    const resp = await fetch(`${url}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid }),
      signal: AbortSignal.timeout(10_000),
    })
    return await resp.json()
  } catch {
    return { valid: false, message: 'Server không phản hồi' }
  }
}

// ══════════════════════════════════════════════════
// LAYER 4: Anti-Tamper + License Check
// ══════════════════════════════════════════════════

function checkExpiry(expires: string): boolean {
  if (!expires || expires === 'LIFETIME') return true
  try {
    const exp = new Date(expires + 'T23:59:59')
    return Date.now() < exp.getTime()
  } catch { return false }
}

function checkGracePeriod(lastVerified: number): boolean {
  const elapsed = Date.now() - lastVerified
  return elapsed < GRACE_DAYS * 24 * 60 * 60 * 1000
}

function checkTimeConsistency(cache: CacheData): boolean {
  // Anti-rewind: current time should be >= lastBoot
  // Attacker setting clock backwards will be caught
  const now = Date.now()
  if (now < cache.lastBoot - 300_000) return false // 5min tolerance
  return true
}

/**
 * Main license gate — called at app startup
 * Returns: { valid, message, expires, needsActivation }
 */
async function checkLicense(): Promise<{
  valid: boolean
  message: string
  expires?: string
  needsActivation: boolean
}> {
  const hwid = getHWID()
  const cache = decryptCache(hwid)

  // No cache → needs activation
  if (!cache) {
    return { valid: false, message: 'Chưa kích hoạt license', needsActivation: true }
  }

  // Anti-tamper: HWID mismatch (cache from different machine)
  if (cache.hwid !== hwid) {
    deleteCache()
    return { valid: false, message: 'HWID không khớp', needsActivation: true }
  }

  // Anti-tamper: time rewind detection
  if (!checkTimeConsistency(cache)) {
    return { valid: false, message: 'Phát hiện thay đổi thời gian hệ thống', needsActivation: true }
  }

  // Check expiry
  if (!checkExpiry(cache.expires)) {
    deleteCache()
    return { valid: false, message: 'License đã hết hạn', needsActivation: true }
  }

  // Try online verify first
  const online = await serverVerify(cache.key, hwid)
  if (online.valid) {
    // Update cache with fresh timestamp
    cache.lastVerified = Date.now()
    cache.lastBoot = Date.now()
    if (online.expires) cache.expires = online.expires
    saveCache(cache)
    return { valid: true, message: online.message, expires: cache.expires, needsActivation: false }
  }

  // Server says invalid → check if it's a connection error
  if (online.message.includes('Server không phản hồi') || online.message.includes('kết nối')) {
    // Offline fallback — check grace period
    if (checkGracePeriod(cache.lastVerified)) {
      const daysLeft = Math.ceil((GRACE_DAYS * 24 * 60 * 60 * 1000 - (Date.now() - cache.lastVerified)) / (24 * 60 * 60 * 1000))
      return {
        valid: true,
        message: `✅ Offline mode (còn ${daysLeft} ngày)`,
        expires: cache.expires,
        needsActivation: false,
      }
    }
    // Grace period expired
    return { valid: false, message: 'Hết hạn offline. Cần kết nối internet để xác minh.', needsActivation: false }
  }

  // Server explicitly rejected → key revoked or invalid
  deleteCache()
  return { valid: false, message: online.message, needsActivation: true }
}

/**
 * Activate license key
 */
async function activateLicense(key: string): Promise<{ success: boolean; message: string }> {
  const hwid = getHWID()
  const result = await serverActivate(key, hwid)

  if (result.success) {
    // Save encrypted cache
    const cache: CacheData = {
      key,
      hwid,
      expires: result.expires || 'LIFETIME',
      lastVerified: Date.now(),
      lastBoot: Date.now(),
    }
    saveCache(cache)
    return { success: true, message: result.message }
  }

  return { success: false, message: result.message }
}

/**
 * Background heartbeat — verify every 60s silently
 */
function startHeartbeat(): void {
  if (_heartbeatTimer) return

  _heartbeatTimer = setInterval(async () => {
    const hwid = getHWID()
    const cache = decryptCache(hwid)
    if (!cache) return

    const online = await serverVerify(cache.key, hwid)
    if (online.valid) {
      cache.lastVerified = Date.now()
      cache.lastBoot = Date.now()
      saveCache(cache)
    }
    // If server unreachable, keep existing cache (grace period handles it)
  }, HEARTBEAT_MS)
}

function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer)
    _heartbeatTimer = null
  }
}

/**
 * Deactivate — clear local cache
 */
function deactivateLicense(): void {
  deleteCache()
  stopHeartbeat()
  _cachedHWID = null
}

// ══════════════════════════════════════════════════
// IPC Registration
// ══════════════════════════════════════════════════

export function registerLicenseIPC(): void {
  ipcMain.handle('license:check', async () => {
    return checkLicense()
  })

  ipcMain.handle('license:activate', async (_event, { key }: { key: string }) => {
    const result = await activateLicense(key)
    if (result.success) startHeartbeat()
    return result
  })

  ipcMain.handle('license:deactivate', async () => {
    deactivateLicense()
    return { success: true }
  })

  ipcMain.handle('license:hwid', async () => {
    return { hwid: getHWID() }
  })
}

export { checkLicense, startHeartbeat, stopHeartbeat }
