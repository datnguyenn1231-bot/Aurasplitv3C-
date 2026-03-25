/**
 * Integrity Check — Layer 2
 * 
 * Cracker note: If app.asar is modified (repacked after patching),
 * the hash won't match. Instead of showing an error (too obvious),
 * we silently corrupt functionality — cracker thinks crack worked
 * but output files are broken. Maximum frustration.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'

let _integrityOK = true

// Hash computed at build time and embedded
// Will be replaced by build script with actual hash
const _EXPECTED = '%%ASAR_HASH%%'

export function checkIntegrity(): boolean {
  if (!app.isPackaged) {
    _integrityOK = true
    return true
  }

  try {
    const asarPath = path.join(process.resourcesPath, 'app.asar')
    if (!fs.existsSync(asarPath)) {
      // Running from unpacked dir (dev or already extracted)
      _integrityOK = false
      return false
    }

    // Read first 64KB + last 64KB for fast hash (full file = slow)
    const fd = fs.openSync(asarPath, 'r')
    const stat = fs.fstatSync(fd)
    const headBuf = Buffer.alloc(Math.min(65536, stat.size))
    const tailBuf = Buffer.alloc(Math.min(65536, stat.size))
    
    fs.readSync(fd, headBuf, 0, headBuf.length, 0)
    fs.readSync(fd, tailBuf, 0, tailBuf.length, Math.max(0, stat.size - tailBuf.length))
    fs.closeSync(fd)

    const hash = crypto.createHash('sha256')
      .update(headBuf)
      .update(tailBuf)
      .update(String(stat.size))
      .digest('hex')
      .slice(0, 16)

    _integrityOK = (_EXPECTED === '%%ASAR_HASH%%') || (hash === _EXPECTED)
    return _integrityOK
  } catch {
    _integrityOK = false
    return false
  }
}

/**
 * Ghost check — used by other modules to silently degrade
 * Returns true if app is clean, false if tampered
 */
export function isClean(): boolean {
  return _integrityOK
}
