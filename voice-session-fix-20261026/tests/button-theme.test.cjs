const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cssom = require('rrweb-cssom');
const base = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(base, 'assets/button-theme.css'), 'utf8');
const source = fs.readFileSync(path.join(base, 'assets/styles.css'), 'utf8');
const sheet = cssom.parse(css);
function tokens(text, selector) {
  const rules = cssom.parse(text).cssRules;
  const result = {};
  for (const r of rules) if (r.selectorText === selector) {
    for (let i = 0; i < r.style.length; i++) {
      const key = r.style[i];
      if (key.startsWith('--')) result[key] = r.style.getPropertyValue(key).trim();
    }
  }
  return result;
}
function lum(hex) {
  const channel = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channel[0] * .2126 + channel[1] * .7152 + channel[2] * .0722;
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
for (const theme of ['light', 'dark', 'macaron']) {
  test(`${theme}: button text contrast >= 4.5:1`, () => {
    const selector = `html[data-theme="${theme}"]`;
    const t = { ...tokens(source, ':root'), ...tokens(source, selector), ...tokens(css, ':root'), ...tokens(css, selector) };
    const pairs = [
      ['primary start', '--button-on-fill', '--button-fill-start'],
      ['primary end', '--button-on-fill', '--button-fill-end'],
      ['danger', '--button-on-danger', '--button-danger-fill'],
      ['selected / time', '--button-accent-ink', '--primary-soft'],
      ['danger ghost', '--button-danger-ink', '--danger-soft'],
      ['secondary', '--text', '--surface'],
      ['icon / idle', '--text-2', '--surface'],
    ];
    for (const [name, ink, fill] of pairs) {
      const ratio = contrast(t[ink], t[fill]);
      assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1 (${t[ink]} on ${t[fill]})`);
      console.log(`${theme} / ${name}: ${ratio.toFixed(2)}:1`);
    }
  });
}
test('CSS parses, uses reduced motion and preserves fine-pointer hover restriction', () => {
  assert.ok(sheet.cssRules.length > 20);
  assert.ok([...sheet.cssRules].some(r => r.conditionText === '(prefers-reduced-motion: reduce)' || r.media?.mediaText === '(prefers-reduced-motion: reduce)'));
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /button:focus-visible\s*\{[^}]*outline: 3px/);
});
