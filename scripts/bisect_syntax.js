const fs = require('fs');const child = require('child_process');const file = process.argv[2];if(!file){console.error('Usage: node bisect_syntax.js <file>');process.exit(2);}const s = fs.readFileSync(file,'utf8');const lines = s.split('\n');let lo = 1, hi = lines.length; function check(n){const out = lines.slice(0,n).join('\n'); fs.writeFileSync('tmp_slice.mjs', out); try{ child.execSync('node --check tmp_slice.mjs',{stdio:'ignore'}); return true;}catch(e){return false;} }
// find smallest n where check(n) is false
let firstFail = null;
let l=1, r=hi;
while(l<=r){const m=Math.floor((l+r)/2); if(!check(m)){ firstFail = m; r = m-1; } else { l = m+1; }}
if(firstFail){console.log('First failing line approx:', firstFail); console.log('Context:\n', lines.slice(Math.max(0,firstFail-8), firstFail+8).join('\n')); } else { console.log('No failure detected'); }
