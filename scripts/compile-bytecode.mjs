/**
 * V8 Bytecode Compiler — Must run through Electron (same V8 version)
 * Usage: npx electron scripts/compile-bytecode.mjs
 */
import bytenode from 'bytenode'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist-electron')

console.log('🔒 V8 Bytecode: Compiling with Electron V8...')

const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'))

for (const file of files) {
    const filePath = path.join(distDir, file)
    const code = fs.readFileSync(filePath, 'utf-8')
    if (code.length < 50) continue

    const baseName = file.replace(/\.(m?js)$/, '')
    const ext = file.match(/\.(m?js)$/)?.[1] || 'js'
    const jscPath = path.join(distDir, `${baseName}.jsc`)

    try {
        await bytenode.compileFile(filePath, jscPath)
        
        // Replace original .js with tiny loader
        const loader = `'use strict';require('bytenode');require('./${baseName}.jsc');`
        fs.writeFileSync(filePath, loader)
        
        const jscSize = fs.statSync(jscPath).size
        console.log(`  ✅ ${file} → ${baseName}.jsc (${Math.round(jscSize/1024)} KB binary)`)
    } catch (e) {
        console.error(`  ❌ ${file}: ${e.message}`)
    }
}

console.log('✅ Done! .jsc = V8 binary, AI cannot read')
process.exit(0)
