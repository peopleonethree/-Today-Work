const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
function setup() {
  const dom = new JSDOM('<div id="outside">保留</div><div id="guide-pager" tabindex="-1"></div>', { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(root, 'assets/js/guide-v2.js'), 'utf8'));
  return dom;
}
test('ten unique themes render complete accessible cards and visible progress', () => {
  const dom = setup();
  const api = dom.window.GuideV2;
  const box = dom.window.document.getElementById('guide-pager');
  assert.equal(api.items.length, 10);
  assert.equal(new Set(api.items.map(i => i.key)).size, 10);
  assert.equal(api.items.reduce((count, item) => count + item.cards.length, 0), 40);
  api.items.forEach((item, index) => {
    api.render(box, item, index);
    assert.equal(box.querySelectorAll('article').length, 1);
    assert.equal(box.querySelector('h2').textContent, item.title);
    assert.equal(box.querySelector('.gv-progress').textContent, `${index + 1} / 10`);
    assert.equal(box.querySelector('[aria-live]').getAttribute('aria-live'), 'polite');
    assert.equal(box.querySelectorAll('details > summary').length, 4);
    box.querySelectorAll('details').forEach(card => {
      assert.ok(card.querySelector('.gv-card-body').textContent.length > 25);
    });
    assert.equal(box.getAttribute('tabindex'), '-1');
    assert.equal(dom.window.document.getElementById('outside').textContent, '保留');
  });
});
test('rerender resets scroll and never interprets content as markup', () => {
  const dom = setup();
  const api = dom.window.GuideV2;
  const box = dom.window.document.getElementById('guide-pager');
  box.scrollTop = 100;
  api.render(box, { title: '<img onerror="bad()">', text: '<script>bad()</script>', cards: [['!', '<b>标题</b>', '提示', '<img src=x>']], icon: '*', eyebrow: '测试' }, 0);
  assert.equal(box.scrollTop, 0);
  assert.equal(box.querySelectorAll('script,img,b').length, 0);
  assert.equal(box.querySelector('strong').textContent, '<b>标题</b>');
});
test('coverage includes real workflows and avoids invented cloud or QR importing', () => {
  const dom = setup();
  const text = JSON.stringify(dom.window.GuideV2.items);
  for (const term of ['已办', '离线转写', '复制全文', '灰度', '提取待办', '标签', '扩写', '问', '周评', '回滚', '脱敏', '游客', '裁剪', '自启动']) assert.ok(text.includes(term), term);
  assert.ok(text.includes('不提供云同步'));
  assert.ok(!text.includes('扫码导入'));
});

test('voice guide distinguishes explicit digit adoption, chosen reminders and transcription limits', () => {
  const dom = setup();
  const byKey = Object.fromEntries(dom.window.GuideV2.items.map(item => [item.key, JSON.stringify(item)]));
  for (const term of ['按标点分句', '普通句子不改写', '按数字采用', '恢复原文', '旧候选失效', '不改变已选提醒', '漏掉的数字', 'Zipformer', '局域网', '不能保证整条链路不联网']) {
    assert.ok(byKey.voice.includes(term), `voice: ${term}`);
  }
  for (const term of ['点选才设置提醒', '尚未过去', '多个时间是备选', '还需点 ＋ 创建', '手工输入', '复制全文到剪贴板']) {
    assert.ok(byKey.voice.includes(term), `voice: ${term}`);
  }
  for (const term of ['笔记离线转写', '普通句子不改写', '结束录音后', '立即保存', '保存状态']) {
    assert.ok(byKey.memos.includes(term), `memos: ${term}`);
  }
  assert.ok(byKey.settings.includes('不是设备断网开关'));
  assert.ok(byKey.settings.includes('非服务商账单'));
});

test('audit and usage docs preserve evidence boundaries and link to each other', () => {
  const read = file => fs.readFileSync(path.join(root, 'docs', file), 'utf8');
  const usage = read('功能使用指引.md');
  const map = read('功能思维导图.md');
  const audit = read('功能指引差异核对.md');
  for (const content of [usage, map, audit]) {
    for (const term of ['Zipformer', '普通句子', '暂缓', '声学', 'VoiceEngine.java']) assert.ok(content.includes(term), term);
    assert.ok(content.includes('功能指引差异核对') || content === audit);
  }
  assert.ok(audit.includes('没有操作手机'));
  assert.ok(audit.includes('不是真实录音'));
  assert.ok(usage.includes('不会安装、升级语音声学模型'));
});
