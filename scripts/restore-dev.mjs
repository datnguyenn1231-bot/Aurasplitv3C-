/**
 * Restore package.json "main" back to dist-electron/main.js for DEV mode.
 * Run this after building EXE if you want to switch back to DEV mode.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
pkg.main = 'dist-electron/main.js'
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log('✅ package.json "main" → dist-electron/main.js (DEV mode)')
