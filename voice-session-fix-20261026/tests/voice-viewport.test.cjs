const {test} = require('node:test');
const assert = require('node:assert/strict');
const {make, sleep} = require('./app-env.cjs');

test('voice panel follows repeated viewport changes and clears geometry on close', async t => {
  const e = await make(t, {viewport: true});
  const viewport = e.w.visualViewport;
  const layer = e.$('voice-layer');
  const edit = e.$('voice-edit');
  e.w.document.querySelector('[data-vt="dict"]').click();
  e.$('voice-btn').click();
  edit.value = '保留这段草稿';
  edit.dispatchEvent(new e.w.Event('input'));
  edit.focus();

  async function resize(height, offset, layoutHeight) {
    e.w.innerHeight = layoutHeight;
    viewport.height = height;
    viewport.offsetTop = offset;
    viewport.dispatchEvent(new e.w.Event('resize'));
    viewport.dispatchEvent(new e.w.Event('scroll'));
    e.w.dispatchEvent(new e.w.Event('resize'));
    await sleep(45);
  }
  for (let i = 0; i < 6; i++) {
    // WebView may resize both viewports, or only the visual viewport.
    await resize(438, i % 2 ? 28 : 0, i % 2 ? 760 : 438);
    assert.equal(layer.style.getPropertyValue('--vox-viewport-height'), '438px');
    assert.equal(layer.style.getPropertyValue('--vox-viewport-top'), i % 2 ? '28px' : '0px');
    await resize(760, 0, 760);
    assert.equal(layer.style.getPropertyValue('--vox-viewport-height'), '760px');
    assert.equal(layer.style.getPropertyValue('--vox-viewport-top'), '0px');
  }
  e.$('voice-cancel').click();
  await resize(438, 28, 760);
  assert.equal(e.w.document.activeElement, e.w.document.body);
  assert.equal(layer.style.getPropertyValue('--vox-viewport-height'), '');
  assert.equal(layer.style.getPropertyValue('--vox-viewport-top'), '');
  assert.equal(e.w.localStorage.getItem('voice.draft'), '保留这段草稿');
});

test('finishing a transcription does not take focus or open the keyboard', async t => {
  const e = await make(t);
  e.w.document.querySelector('[data-vt="dict"]').click();
  e.$('voice-btn').click();
  e.done(e.segment(1), '转写测试');
  e.stopped();
  assert.equal(e.$('voice-edit').value, '转写测试');
  assert.equal(e.$('voice-layer').dataset.state, 'review');
  assert.notEqual(e.w.document.activeElement, e.$('voice-edit'));
});
