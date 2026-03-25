/**
 * V8 Bytecode Pipeline — FINAL
 * 
 * 1. esbuild: main.js ESM → CJS (with import.meta.url polyfill)
 * 2. bytenode: CJS → main.jsc (V8 binary, compiled via Electron's V8)
 * 3. esbuild: bundle loader_source.cjs + bytenode → main.cjs (self-contained)
 * 
 * Result: main.cjs (has bytenode inside) → loads main.jsc (V8 BINARY)
 *         No external modules needed at runtime!
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.join(__dirname, '..')
const distDir = path.join(projectDir, 'dist-electron')

console.log('🔒 V8 Bytecode Pipeline (Final)\n')

// ═══════════════════════════════════════════════
// Step 1: ESM → CJS + import.meta.url polyfill
// ═══════════════════════════════════════════════
const mainJs = path.join(distDir, 'main.js')
const mainCjsTemp = mainJs + '.cjs'

console.log('  📦 Step 1: main.js ESM → CJS...')
execSync([
    'npx esbuild',
    `"${mainJs}"`,
    '--bundle --platform=node --format=cjs',
    `--outfile="${mainCjsTemp}"`,
    '--external:electron',
    `--banner:js="var __import_meta_url=require('url').pathToFileURL(__filename).href;"`,
    '--define:import.meta.url=__import_meta_url',
].join(' '), { cwd: projectDir, stdio: 'pipe' })

fs.copyFileSync(mainCjsTemp, mainJs)
fs.unlinkSync(mainCjsTemp)
console.log('  ✅ ESM → CJS (import.meta.url polyfilled)\n')

// ═══════════════════════════════════════════════
// Step 2: Compile CJS → V8 bytecode via Electron
// ═══════════════════════════════════════════════
console.log('  🔒 Step 2: CJS → V8 bytecode...')
const compileScript = path.join(__dirname, '_compile_jsc.cjs')
const bytenodePath = path.join(projectDir, 'node_modules', 'bytenode').replace(/\\/g, '\\\\')

fs.writeFileSync(compileScript, `
const v8 = require('node:v8');
v8.setFlagsFromString('--no-lazy');
const bytenode = require('${bytenodePath}');
const fs = require('fs');

async function main() {
    const src = ${JSON.stringify(path.join(distDir, 'main.js'))};
    const out = ${JSON.stringify(path.join(distDir, 'main.jsc'))};
    try {
        await bytenode.compileFile(src, out);
        const sz = fs.statSync(out).size;
        console.log('  ✅ main.jsc (' + Math.round(sz/1024) + ' KB V8 binary)');
    } catch (e) {
        console.error('  ❌ ' + e.message);
        process.exit(1);
    }
    process.exit(0);
}
main();
`)

try {
    execSync(`npx electron "${compileScript}"`, {
        cwd: projectDir, stdio: 'inherit', timeout: 30000,
    })
} catch (e) {
    console.error('❌ Bytecode compile failed!')
    try { fs.unlinkSync(compileScript) } catch {}
    process.exit(1)
}
try { fs.unlinkSync(compileScript) } catch {}

// ═══════════════════════════════════════════════
// Step 3: Bundle loader + bytenode → self-contained main.cjs
// ═══════════════════════════════════════════════
console.log('\n  📦 Step 3: Bundle loader + bytenode → main.cjs...')
const loaderSource = path.join(projectDir, 'loader_source.cjs')
const mainCjsOut = path.join(distDir, 'main.cjs')

execSync([
    'npx esbuild',
    `"${loaderSource}"`,
    '--bundle --platform=node',
    '--external:electron',
    '--external:./main.jsc',
    `--outfile="${mainCjsOut}"`,
].join(' '), { cwd: projectDir, stdio: 'pipe' })

const cjsSize = fs.statSync(mainCjsOut).size
console.log(`  ✅ main.cjs (${Math.round(cjsSize/1024)} KB — bytenode bundled inside)\n`)

// ═══════════════════════════════════════════════
// Verify
// ═══════════════════════════════════════════════
const mainJsc = path.join(distDir, 'main.jsc')
console.log('  📋 Final files in dist-electron:')
console.log(`     main.jsc  ✅ ${Math.round(fs.statSync(mainJsc).size/1024)} KB (V8 BINARY 🔒)`)
console.log(`     main.cjs  ✅ ${Math.round(cjsSize/1024)} KB (loader + bytenode bundled)`)
console.log(`     main.js   ${Math.round(fs.statSync(mainJs).size/1024)} KB (CJS, not used at runtime)`)

// ═══════════════════════════════════════════════
// Step 4: Switch package.json main → main.cjs for electron-builder
// ═══════════════════════════════════════════════
const pkgPath = path.join(projectDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
pkg.main = 'dist-electron/main.cjs'
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log('\n  🔄 package.json "main" → dist-electron/main.cjs (for electron-builder)')
console.log('     ⚠️  Run `node scripts/restore-dev.mjs` to switch back to main.js for DEV mode')

console.log('\n✅ Pipeline complete! No external modules needed at runtime!')
