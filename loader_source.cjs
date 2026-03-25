// loader_source.cjs — gets bundled with bytenode via esbuild
const v8 = require('v8');
v8.setFlagsFromString('--no-lazy');

require('bytenode');        // esbuild will bundle this inline
require('./main.jsc');      // load compiled V8 bytecode
