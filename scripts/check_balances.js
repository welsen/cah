const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node check_balances.js <file>'); process.exit(2); }
let s = fs.readFileSync(path,'utf8');
let stack = [];
// remove regex literals to avoid confusing character classes with bracket tokens
s = s.replace(/\/(?:\\.|[^\/\\])*\/[gimsuy]*/g, '');
let inBacktick = false;
let inSingle = false;
let inDouble = false;
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  // naive string/backtick skipping
  if (ch === '`' && !inSingle && !inDouble) { inBacktick = !inBacktick; continue; }
  if (inBacktick) continue;
  if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
  if (inSingle) continue;
  if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
  if (inDouble) continue;
  if ('({['.includes(ch)) stack.push({ch, i});
  else if (')}]'.includes(ch)) {
    if (!stack.length) { console.error('Unmatched closing', ch, 'at', i+1); process.exit(1); }
    const top = stack.pop();
    const pairs = { '(':')','{':'}','[':']' };
    if (pairs[top.ch] !== ch) { console.error('Mismatch', top.ch, 'at', top.i+1, 'vs', ch, 'at', i+1); process.exit(1); }
  }
}
if (inBacktick) { console.error('Unclosed backtick'); process.exit(1); }
if (inSingle) { console.error('Unclosed single quote'); process.exit(1); }
if (inDouble) { console.error('Unclosed double quote'); process.exit(1); }
if (stack.length) { const top = stack[stack.length-1]; console.error('Unclosed', top.ch, 'at', top.i+1); process.exit(1); }
console.log('Looks balanced');
process.exit(0);
