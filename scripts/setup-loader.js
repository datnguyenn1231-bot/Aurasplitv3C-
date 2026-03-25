/**
 * V8 Bytecode Loader — gets bundled with bytenode via esbuild
 * Output: dist-electron/main.cjs (self-contained, no external deps)
 */
const v8 = require('node:v8');
const path = require('node:path');
const bytenode = require('bytenode');

// Disable V8 lazy compilation for bytecode compatibility
v8.setFlagsFromString('--no-lazy');

// Load compiled bytecode
const jscPath = path.join(__dirname, 'main.jsc');
require(jscPath);
