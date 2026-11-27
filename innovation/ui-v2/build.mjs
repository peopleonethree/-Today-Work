// 把补丁应用到冻结的原始文件上，产出测试用资源。
//   node build.mjs            → 产出优化版（styles.css / app.js / index.html）
//   node build.mjs --base     → 还原成原始版，用于对照测试
// 只读 orig/，只写 assets/，不碰 G:/About。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandIs } from './lib/css-expand.mjs';

const must = (cond, message) => { if (!cond) throw new Error(message); };

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/* 行尾必须以「装机字节」为准，不能跟随检出结果。
   踩过的坑：core.autocrlf、GitHub 归档包、编辑器保存都可能改掉 orig/ 的行尾，
   而旧实现用 eolOf() 把「检出时的行尾」当真值、悄悄照着产，
   结果整条产物哈希漂移，却只有末端的 sha256sum -c 能发现，离根因已经很远。
   这里按 .gitattributes 同源的常量钉死：styles.css / index.html 是 LF，app.js 是 CRLF。 */
const CANON_EOL = { 'styles.css': '\n', 'index.html': '\n', 'message-workbench.css': '\n', 'app.js': '\r\n' };
const warned = new Set();
const eolOf = (name) => {
  const eol = CANON_EOL[name];
  must(eol, `未知文件 ${name}：请先在 build.mjs 的 CANON_EOL 里登记它的行尾`);
  return eol;
};
// 统一行尾：先把 CRLF 和孤立 CR 都归一成 LF，再按目标行尾重写（混合行尾也能收敛）
const toEol = (text, eol) => text.replace(/\r\n?/g, '\n').replace(/\n/g, eol);
const orig = (name) => {
  const raw = readFileSync(join(ROOT, 'orig', name), 'utf8');
  const eol = eolOf(name);
  const crlf = (raw.match(/\r\n/g) || []).length;
  const loneLf = (raw.match(/\n/g) || []).length - crlf;
  const loneCr = (raw.match(/\r(?!\n)/g) || []).length; // 老 Mac 风格的孤立 CR
  const off = eol === '\n' ? crlf > 0 || loneCr > 0 : loneLf > 0 || crlf === 0;
  if (off && !warned.has(name)) {
    warned.add(name);
    console.warn('[warn] orig/%s 的行尾不是预期值（%s），多半是 core.autocrlf 或归档工具改的；已按规范行尾归一，产物仍可复现',
      name, eol === '\n' ? 'LF' : 'CRLF');
  }
  return toEol(raw, eol);
};
const patch = (name) => readFileSync(join(ROOT, 'patches', name), 'utf8');
// 全新克隆里没有 assets/（生成物不入库），写出前按需建目录
const out = (name, text) => {
  const file = join(ROOT, 'assets', name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
// 补丁块按目标文件的行尾重写；目标行尾来自 CANON_EOL，不来自检出
const matchEol = (target, text) => toEol(text, eolOf(target));

// index.html 重排选项行时用（插入的行要和目标文件行尾一致）
const EOL = eolOf('index.html');


function moveOptions(html) {
  // 1) 「消息提醒与词库」从独占一行，挪到选项行右端
  const entryRe = /[ \t]*<button type="button" class="btn btn--ghost btn--sm" id="open-message-workbench">消息提醒与词库<\/button>\r?\n/;
  // 2) 「添加附件」从输入行，挪到选项行，变成带文字的选项标签
  const drawRe = /[ \t]*<button class="addbar__mic" id="draw-btn" type="button" aria-label="添加附件" title="添加附件">\r?\n[\s\S]*?<\/button>\r?\n/;
  must(entryRe.test(html), 'index.html：找不到词库入口按钮');
  must(drawRe.test(html), 'index.html：找不到附件按钮');
  html = html.replace(entryRe, '');
  html = html.replace(drawRe, '');

  const hintAt = html.indexOf('<p class="addbar__hint" id="add-hint" role="alert"></p>');
  must(hintAt > 0, 'index.html：找不到 addmeta 结尾');
  const divAt = html.lastIndexOf('</div>', hintAt);
  must(divAt > 0 && hintAt - divAt < 80, 'index.html：addmeta 结构和预期不符');
  // 插在 </div> 那一行的行首，缩进才对得上
  const closeAt = html.lastIndexOf(EOL, divAt) + EOL.length;
  const chips = [
    '            <button type="button" class="optchip" id="draw-btn" aria-label="添加附件" title="添加附件">',
    '              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">',
    '                <path d="M8.5 12.5l5.7-5.7a2.4 2.4 0 0 1 3.4 3.4l-7.5 7.5a4 4 0 0 1-5.7-5.7l7.1-7.1" fill="none"',
    '                      stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />',
    '              </svg>',
    '              <span>添加附件</span>',
    '            </button>',
    '            <button type="button" class="optlink" id="open-message-workbench">消息提醒与词库</button>',
    '          ',
  ].join(EOL);
  return html.slice(0, closeAt) + chips + html.slice(closeAt);
}

if (process.argv.includes('--base')) {
  out('styles.css', orig('styles.css'));
  out(join('js', 'app.js'), orig('app.js'));
  out('index.html', orig('index.html'));
  console.log('已还原为原始版');
} else {
  const cssEol = eolOf('styles.css');
  let css = orig('styles.css');
  if (!css.endsWith(cssEol)) css += cssEol;
  /* 二分定位用：UI_SECTIONS="0,2,5" 只带第 0/2/5 段；UI_NOJS=1 不带脚本补丁。平时不设这两个变量。 */
  let ui = patch('ui-v2.css');
  if (process.env.UI_SECTIONS) {
    const keep = new Set(process.env.UI_SECTIONS.split(','));
    ui = ui.split(/(?=^\/\* -+ \d+\. )/m).filter((part) => {
      const m = part.match(/^\/\* -+ (\d+)\./);
      return !m || keep.has(m[1]);
    }).join('');
  }
  if (!process.env.UI_NOEXPAND) {
    const before = ui;
    ui = expandIs(ui);
    must(!/:is\(/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')), 'expandIs：展开后仍有 :is(');
    console.log('已展开 :is()：源文件 %d 处，规则块 %d → %d', (before.match(/:is\(/g) || []).length, (before.match(/\{/g) || []).length, (ui.match(/\{/g) || []).length);
  }
  /* 二分定位用：UI_DROPVAR=1 把所有带 var() 的声明整条去掉（只为量「变量解析」在样式重算里占多少，产出的页面不可用）。 */
  if (process.env.UI_DROPVAR) {
    const { walkRules } = await import('./lib/css-expand.mjs');
    let dropped = 0;
    ui = walkRules(ui, (sel, body) => {
      const kept = body.split('\n').filter((l) => { if (!/^\s*[^/]*?var\(/.test(l)) return true; dropped++; return false; });
      return [[sel, kept.join('\n')]];
    });
    console.log('UI_DROPVAR：去掉了 %d 条带 var() 的声明', dropped);
  }
  out('styles.css', css + matchEol('styles.css', ui));

  const jsEol = eolOf('app.js');
  let js = orig('app.js');
  if (!js.endsWith(jsEol)) js += jsEol;
  if (!process.env.UI_NOJS) out(join('js', 'app.js'), js + matchEol('app.js', patch('kb-stable.js')));
  else out(join('js', 'app.js'), js);
  execFileSync(process.execPath, ['--check', join(ROOT, 'assets', 'js', 'app.js')], { stdio: 'inherit' });

  out('index.html', moveOptions(orig('index.html')));
  console.log('已产出优化版（styles.css +%d 行，app.js +%d 行，index.html 已调整选项行）',
    ui.split('\n').length, patch('kb-stable.js').split('\n').length);
}
