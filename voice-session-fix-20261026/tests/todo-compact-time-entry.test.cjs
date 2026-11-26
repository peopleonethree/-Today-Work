const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./app-env.cjs');

const NOW = +new Date(2026, 10, 30, 10, 30);

function draft(env, text) {
  const input = env.$('new-todo');
  input.value = text;
  input.dispatchEvent(new env.w.Event('input', { bubbles: true }));
}

function submit(env) {
  env.$('form-add').dispatchEvent(new env.w.Event('submit', { bubbles: true, cancelable: true }));
}

function stored(env, title) {
  return env.w.AppStorage.read('todos:' + env.user, []).find(todo => todo.text === title);
}

test('adding a compact time phrase stores the action and reminder together', async t => {
  const env = await make(t);
  env.w.Date.now = () => NOW;
  draft(env, '在2222时做月度报告，发给王芳');
  assert.equal(stored(env, '做月度报告，发给王芳'), undefined);
  submit(env);
  assert.equal(stored(env, '做月度报告，发给王芳')?.dueAt, +new Date(2026, 10, 30, 22, 22));
  draft(env, '买牛奶');
  submit(env);
  assert.equal(stored(env, '买牛奶')?.dueAt, null);
});

test('compact times accept midnight, 23:59, full-width digits and roll over to the next day', async t => {
  const env = await make(t);
  env.w.Date.now = () => NOW;
  for (const [text, title, expected] of [
    ['在0000时备份', '备份', new Date(2026, 11, 1, 0, 0)],
    ['在2359时关灯', '关灯', new Date(2026, 10, 30, 23, 59)],
    [' 在　０８０５ 时：吃早饭 ', '吃早饭', new Date(2026, 11, 1, 8, 5)],
    ['在1030时交报告', '交报告', new Date(2026, 11, 1, 10, 30)]
  ]) {
    draft(env, text);
    submit(env);
    assert.equal(stored(env, title)?.dueAt, +expected, text);
  }
});

test('invalid or unmatched compact phrases are saved intact without an automatic reminder', async t => {
  const env = await make(t);
  env.w.Date.now = () => NOW;
  for (const text of [
    '在2400时做笔记', '在1260时做饭', '在10000时开会', '在2 222时开会',
    '我在2222时提交', '项目编号2222', '在2222开会', '在2222时', '在2222时：。'
  ]) {
    draft(env, text);
    submit(env);
    assert.equal(stored(env, text)?.dueAt, null, text);
  }
});

test('an explicitly selected reminder takes priority over the compact phrase', async t => {
  const env = await make(t);
  env.w.Date.now = () => NOW;
  draft(env, '明天下午三点开会');
  env.$('add-time-options').querySelector('button[data-at]').click();
  draft(env, '在2222时开会');
  submit(env);
  assert.equal(stored(env, '开会')?.dueAt, +new Date(2026, 11, 1, 15, 0));
});
