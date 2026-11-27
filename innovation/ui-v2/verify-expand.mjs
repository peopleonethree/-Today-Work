// 核对：产出里的「选择器 + 声明」对，与把源文件里的 :is() 按参数展开后完全一致。
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./patches/ui-v2.css', import.meta.url), 'utf8');
const orig = readFileSync(new URL('./orig/styles.css', import.meta.url), 'utf8');
const out = readFileSync(new URL('./assets/styles.css', import.meta.url), 'utf8').slice(orig.length);
const splitTop = (sel) => { const o = []; let c = '', d = 0; for (const ch of sel) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && d === 0) { o.push(c.trim()); c = ''; continue; } c += ch; } if (c.trim()) o.push(c.trim()); return o; };
function pairs(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, ''); const m = new Map(); const re = /([^{}]+)\{([^{}]*)\}/g; let x;
  while ((x = re.exec(css))) { const sel = x[1].trim(); if (sel.startsWith('@')) continue; const body = x[2].split('\n').map((s) => s.trim()).filter(Boolean).join(';'); for (const s of splitTop(sel)) m.set(s.replace(/\s+/g, ' '), body); }
  return m;
}
function exp(s) { const S = [s]; for (let g = 0; g < 20; g++) { let did = false; const nx = []; for (const t of S) { const at = t.lastIndexOf(':is('); if (at < 0) { nx.push(t); continue; } let d = 0, e = -1; const args = []; let c = ''; for (let i = at + 4; i < t.length; i++) { const ch = t[i]; if (ch === '(') d++; else if (ch === ')') { if (d === 0) { e = i; break; } d--; } if (ch === ',' && d === 0) { args.push(c.trim()); c = ''; continue; } c += ch; } args.push(c.trim()); for (const a of args) nx.push(t.slice(0, at) + a + t.slice(e + 1)); did = true; } S.splice(0, S.length, ...nx); if (!did) break; } return S; }
const A = pairs(src), B = pairs(out); const expA = new Map();
for (const [s, b] of A) for (const e of exp(s)) expA.set(e.replace(/\s+/g, ' '), b);
let bad = 0;
for (const [s, b] of expA) { if (!B.has(s)) { bad++; console.log('产出缺少:', s); } else if (B.get(s) !== b) { bad++; console.log('声明不同:', s); } }
for (const [s] of B) if (!expA.has(s)) { bad++; console.log('产出多出:', s); }
console.log(`选择器+声明：源展开后 ${expA.size} 条，产出 ${B.size} 条，不一致 ${bad}；行数 源 ${src.split('\n').length} → 产出 ${out.split('\n').length}；空行 源 ${src.split('\n').filter((x) => !x.trim()).length} → 产出 ${out.split('\n').filter((x) => !x.trim()).length}`);
process.exit(bad ? 1 : 0);
