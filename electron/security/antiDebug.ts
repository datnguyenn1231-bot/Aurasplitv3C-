/**
 * Anti-Debug — Layer 1
 * 
 * Cracker note: Opening DevTools or attaching debugger
 * will trigger silent app exit after random delay.
 * No error message = cracker doesn't know WHY it crashed.
 */

import { app, BrowserWindow } from 'electron'

let _debugDetected = false

export function initAntiDebug(win: BrowserWindow): void {
  // ── Check 1: DevTools open detection ──
  win.webContents.on('devtools-opened', () => {
    if (app.isPackaged) {
      _debugDetected = true
      // Random delay 3-8s — cracker can't correlate DevTools with crash
      const delay = 3000 + Math.random() * 5000
      setTimeout(() => {
        win.webContents.closeDevTools()
        app.quit()
      }, delay)
    }
  })

  // ── Check 2: --inspect flag detection ──
  if (app.isPackaged) {
    const args = process.argv.join(' ')
    if (args.includes('--inspect') || args.includes('--remote-debugging')) {
      setTimeout(() => app.quit(), 1000 + Math.random() * 3000)
    }
  }

  // ── Check 3: Periodic debugger detection ──
  if (app.isPackaged) {
    setInterval(() => {
      const start = performance.now()
      // debugger statement causes ~100ms pause when debugger attached
      // In production, this is a no-op (< 1ms)
      try {
        const fn = new Function('debugger')
        fn()
      } catch { /* */ }
      const elapsed = performance.now() - start
      if (elapsed > 50) {
        _debugDetected = true
        setTimeout(() => app.quit(), 2000 + Math.random() * 4000)
      }
    }, 15000 + Math.random() * 10000) // Check every 15-25s
  }
}

export function isDebugDetected(): boolean {
  return _debugDetected
}
