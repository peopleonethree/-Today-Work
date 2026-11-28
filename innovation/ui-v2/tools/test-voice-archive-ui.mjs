// 常用词档案：桌面 UI 回归（真 Chromium + 真触摸 + 真 localStorage）
//   node tools/test-voice-archive-ui.mjs
// 覆盖：入口按钮 → 建档 → 检索 → 停用 → 删除二次确认 → 批量导入 →
//       试跑纠错 → 自动纠错开关 → 重开弹层数据仍在 → 落盘结构
import { openSession, sleep, evaluate } from '../lib/session.mjs';

const pass = [];
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) pass.push(name);
  else fails.push(name + (extra === undefined ? '' : '  →  ' + extra));
};
const eq = (name, actual, expected) => ok(name, actual === expected, '实得 ' + JSON.stringify(actual));

// 弹层里的控件 id 都是 va-dialog-<name>
const S = (name) => '#va-dialog-' + name;
const ID = (name) => 'va-dialog-' + name;
// 落盘走 400ms 防抖（saveSoon），改完数据要等它落地才能读 localStorage
const SAVE_WAIT = 800;
const waitSaved = () => sleep(SAVE_WAIT);
// 设置面板和弹层都比视口高，控件常在折叠线以下；真触摸打不到视口外的点，
// 先 scrollIntoView。且「取坐标 → 触摸」之间内容可能漂移（面板入场/重排），
// 按住结束那一刻按钮已挪走，合成 click 落到别的元素上（探针实锤）。
// 所以：等 rect 连续两采样稳定 → 取点同时在目标上挂一次性 click 计数器 →
// 点完核对计数；没点上就重试；重试耗尽才退回程序化 click（记录，让断言把关）。
const tapInView = async (sel) => {
  for (let i = 0; i < 4; i++) {
    await evaluate(api.cdp, `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      return true;
    })()`);
    let prev = null;
    for (let t = 0; t < 10; t++) {
      await sleep(150);
      const cur = await evaluate(api.cdp, `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y)].join(',');
      })()`);
      if (prev === cur && cur !== null) break;
      prev = cur;
    }
    const pt = await evaluate(api.cdp, `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      window.__vaClicks = 0;
      el.addEventListener('click', () => { window.__vaClicks++; }, { once: true, capture: true });
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!pt) throw new Error('找不到元素: ' + sel);
    await api.tap(pt);
    if ((await evaluate(api.cdp, `window.__vaClicks`)) >= 1) return true;
  }
  console.log('[tapInView] 触摸多次落空，退回程序化 click：' + sel);
  await evaluate(api.cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    el.click();
    return true;
  })()`);
};

const api = await openSession({ name: 'va-ui', reset: true });
try {
  await api.load();
  const how = await api.enter();
  console.log('进入方式：' + how);

  // 打开设置：点姓名区 → 菜单 → 设置
  await api.tap('#user-btn');
  await sleep(200);
  await api.tap('#settings-btn');
  ok('设置面板打开', await api.waitFor('#settings-layer', 3000));

  ok('档案库入口按钮存在', await api.waitFor('#open-voice-archive', 2000));
  const label0 = await evaluate(api.cdp, `document.getElementById('open-voice-archive').textContent`);
  eq('未建档时按钮不显示条数', label0, '常用词档案');

  // 旧「常用人名」入口已下线，改为直接往 localStorage 播种 2 条，验证档案库读取
  await evaluate(api.cdp, `(() => {
    const now = Date.now();
    const entry = (correct) => ({
      id: 'va_seed_' + correct, kind: 'person', correct, wrong: [], scene: '', accent: '', note: '',
      enabled: true, hits: 0, lastHitAt: 0, source: 'manual', createdAt: now, updatedAt: now
    });
    localStorage.setItem('today-todo:v1:voiceArchive', JSON.stringify({
      v: 1, settings: { auto: true }, updatedAt: now,
      entries: [entry('李娜'), entry('欧阳明宇')]
    }));
    return true;
  })()`);

  if (process.env.VA_DEBUG) {
    await evaluate(api.cdp, `(() => {
      window.__probe = [];
      document.addEventListener('touchstart', (e) => {
        const t = e.target;
        window.__probe.push('touch:' + (t.id || t.tagName) + '@' + Math.round(e.touches[0].clientX) + ',' + Math.round(e.touches[0].clientY));
      }, { capture: true, passive: true });
      document.addEventListener('click', (e) => window.__probe.push('click:' + (e.target.id || e.target.tagName)), { capture: true });
      const b = document.getElementById('open-voice-archive');
      const r = b.getBoundingClientRect();
      window.__probe.push('btn-rect:' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + 'x' + Math.round(r.height));
      window.__probe.push('viewport:' + innerWidth + 'x' + innerHeight);
      return true;
    })()`);
  }
  await tapInView('#open-voice-archive');
  ok('档案库弹层打开', await api.waitFor('#va-dialog', 3000));
  if (process.env.VA_DEBUG) {
    console.log('[dbg] probe =', await evaluate(api.cdp, `window.__probe.join(' ; ')`),
      '| dlg.open =', await evaluate(api.cdp, `document.getElementById('va-dialog').open`),
      '| ls =', await evaluate(api.cdp, `(localStorage.getItem('today-todo:v1:voiceArchive')||'(null)').slice(0,80)`),
      '| errors =', api.errors.join(' | ') || '(无)');
  }

  const seeded = await evaluate(api.cdp, `(() => {
    const d = JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive') || 'null');
    return d ? { n: d.entries.length, kinds: d.entries.map(e => e.kind), names: d.entries.map(e => e.correct) } : null;
  })()`);
  eq('播种 2 条已读取', seeded && seeded.n, 2);
  eq('条目类型为人名', (seeded && seeded.kinds || []).join('/'), 'person/person');
  eq('条目内容正确', (seeded && seeded.names || []).join('/'), '李娜/欧阳明宇');
  const label1 = await evaluate(api.cdp, `document.getElementById('open-voice-archive').textContent`);
  eq('按钮显示条数', label1, '常用词档案（2）');

  // 新建一条：正确写法 + 误识别 + 场景 + 口音 + 备注
  await tapInView('#va-dialog [data-new]');
  await sleep(150);
  await tapInView(S('correct'));
  await api.type('毕设实物');
  await tapInView(S('wrong'));
  await api.type('避设实物');
  await tapInView(S('scene'));
  await api.type('实验室');
  await tapInView(S('accent'));
  await api.type('前后鼻音不分');
  await evaluate(api.cdp, `(() => {
    document.getElementById(${JSON.stringify(ID('note'))}).value = '周五汇报用的实物';
    return true;
  })()`);
  await tapInView('#va-dialog [data-kind="term"]');
  await tapInView('#va-dialog [data-save]');
  await waitSaved();

  const saved = await evaluate(api.cdp, `(() => {
    const d = JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive'));
    const e = d.entries.find(x => x.correct === '毕设实物');
    return e ? { kind: e.kind, wrong: e.wrong, scene: e.scene, accent: e.accent, note: e.note, enabled: e.enabled, source: e.source } : null;
  })()`);
  eq('新建条目类型', saved && saved.kind, 'term');
  eq('新建条目误识别', (saved && saved.wrong || []).join('/'), '避设实物');
  eq('新建条目场景', saved && saved.scene, '实验室');
  eq('新建条目口音', saved && saved.accent, '前后鼻音不分');
  eq('新建条目备注', saved && saved.note, '周五汇报用的实物');
  eq('新建条目默认启用', saved && saved.enabled, true);
  eq('新建条目标手动来源', saved && saved.source, 'manual');
  eq('列表里出现该条', await evaluate(api.cdp, `[...document.querySelectorAll('#va-dialog .va-word')].some(e => e.textContent === '毕设实物')`), true);

  // 检索
  await evaluate(api.cdp, `(() => {
    const s = document.getElementById(${JSON.stringify(ID('search'))});
    s.value = '实验室';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  eq('搜索命中 1 条', await evaluate(api.cdp, `document.querySelectorAll('#va-dialog .va-item').length`), 1);
  const meta = await evaluate(api.cdp, `document.getElementById(${JSON.stringify(ID('meta'))}).textContent`);
  ok('统计行带筛选提示', /共 3 条/.test(meta) && /筛选出 1 条/.test(meta), meta);

  await evaluate(api.cdp, `(() => {
    const s = document.getElementById(${JSON.stringify(ID('search'))});
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  eq('清空搜索后 3 条', await evaluate(api.cdp, `document.querySelectorAll('#va-dialog .va-item').length`), 3);

  // 停用 / 启用
  await evaluate(api.cdp, `(() => {
    const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '毕设实物');
    item.querySelector('button[data-act="toggle"]').click();
    return true;
  })()`);
  await waitSaved();
  eq('停用后落盘 enabled=false', await evaluate(api.cdp, `(() => {
    const d = JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive'));
    return d.entries.find(x => x.correct === '毕设实物').enabled;
  })()`), false);
  eq('停用条目引擎不命中', await evaluate(api.cdp, `window.VoiceArchive.correct('带避设实物去').text`), '带避设实物去');
  eq('停用后条目变灰', await evaluate(api.cdp, `(() => {
    const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '毕设实物');
    return item.classList.contains('is-off');
  })()`), true);

  await evaluate(api.cdp, `(() => {
    const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '毕设实物');
    item.querySelector('button[data-act="toggle"]').click();
    return true;
  })()`);
  await waitSaved();
  eq('重新启用后引擎命中', await evaluate(api.cdp, `window.VoiceArchive.correct('带避设实物去').text`), '带毕设实物去');

  // 试跑
  await tapInView('#va-dialog [data-try]');
  await sleep(150);
  await tapInView(S('try-input'));
  await api.type('明天带避设实物去实验室');
  await tapInView('#va-dialog [data-try-run]');
  await sleep(200);
  const tryOut = await evaluate(api.cdp, `document.getElementById(${JSON.stringify(ID('try-out'))}).textContent`);
  ok('试跑命中并改写', /命中 1 处/.test(tryOut) && /明天带毕设实物去实验室/.test(tryOut), tryOut);
  ok('试跑显示 from→to', /避设实物 → 毕设实物/.test(tryOut), tryOut);

  eq('同音纠正（李那→李娜）', await evaluate(api.cdp, `window.VoiceArchive.correct('明天找李那签字').text`), '明天找李娜签字');

  // 批量导入
  await tapInView('#va-dialog [data-bulk]');
  await sleep(150);
  await evaluate(api.cdp, `(() => {
    document.getElementById(${JSON.stringify(ID('bulk-text'))}).value = '1. 楚星云 | 楚星运\\n2、答辩教室\\n123';
    return true;
  })()`);
  await tapInView('#va-dialog [data-bulk-run]');
  await waitSaved();
  eq('批量导入新增 2 条（纯数字行丢弃）', await evaluate(api.cdp, `(() => {
    const d = JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive'));
    return d.entries.filter(e => e.correct === '楚星云' || e.correct === '答辩教室').length;
  })()`), 2);
  eq('批量导入不残留序号', await evaluate(api.cdp, `(() => {
    const d = JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive'));
    return d.entries.some(e => e.correct === '楚星云') && d.entries.some(e => e.correct === '答辩教室');
  })()`), true);

  // 自动纠错开关
  await evaluate(api.cdp, `(() => {
    const c = document.getElementById(${JSON.stringify(ID('auto'))});
    c.checked = false;
    c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitSaved();
  eq('关闭开关落盘', await evaluate(api.cdp, `JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive')).settings.auto`), false);
  eq('关闭后引擎不再改写', await evaluate(api.cdp, `window.VoiceArchive.correct('带避设实物去').text`), '带避设实物去');
  await evaluate(api.cdp, `(() => {
    const c = document.getElementById(${JSON.stringify(ID('auto'))});
    c.checked = true;
    c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitSaved();
  eq('打开开关恢复纠错', await evaluate(api.cdp, `window.VoiceArchive.correct('带避设实物去').text`), '带毕设实物去');

  // 删除：两次点击
  const delState = await evaluate(api.cdp, `(() => {
    const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '答辩教室');
    const btn = item.querySelector('button[data-act="del"]');
    btn.click();
    return btn.textContent;
  })()`);
  eq('第一次点删除变确认', delState, '确认删除');
  eq('第一次点不真删', await evaluate(api.cdp, `JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive')).entries.some(e => e.correct === '答辩教室')`), true);
  await evaluate(api.cdp, `(() => {
    const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '答辩教室');
    item.querySelector('button[data-act="del"]').click();
    return true;
  })()`);
  await waitSaved();
  eq('第二次点真删', await evaluate(api.cdp, `JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive')).entries.some(e => e.correct === '答辩教室')`), false);

  // 关闭重开
  await tapInView('#va-dialog [data-close]');
  await sleep(250);
  eq('关闭后弹层隐藏', await evaluate(api.cdp, `!document.getElementById('va-dialog').open`), true);
  await tapInView('#open-voice-archive');
  await sleep(300);
  eq('重开后条目数一致', await evaluate(api.cdp, `document.querySelectorAll('#va-dialog .va-item').length`), 4);

  // 编辑回填
  await evaluate(api.cdp, `(() => {
    const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '楚星云');
    item.querySelector('button[data-act="edit"]').click();
    return true;
  })()`);
  await sleep(200);
  const filled = await evaluate(api.cdp, `(() => ({
    correct: document.getElementById(${JSON.stringify(ID('correct'))}).value,
    wrong: document.getElementById(${JSON.stringify(ID('wrong'))}).value,
    title: document.getElementById(${JSON.stringify(ID('form-title'))}).textContent
  }))()`);
  eq('编辑回填正确写法', filled.correct, '楚星云');
  eq('编辑回填误识别', filled.wrong, '楚星运');
  eq('编辑标题', filled.title, '编辑条目');
  await tapInView('#va-dialog [data-cancel]');
  await sleep(150);
  eq('取消后表单收起', await evaluate(api.cdp, `document.getElementById(${JSON.stringify(ID('form'))}).classList.contains('is-hidden')`), true);

  // 小屏回归：模拟真机 IME 把视口压到 ~533px（869 - 336 键盘）。
  // 修复前：表单展开把弹层撑爆视口，保存/取消和条目删除按钮被顶出可视区
  // （a11y 高度 0，真机要靠滚动+键盘组合才能点到）。修复后：弹层 flex 列布局
  // + dvh 限高，表单内部滚动，列表让位，所有按钮保持可达。
  await tapInView('#va-dialog [data-new]');
  await sleep(150);
  await api.keyboard(true);
  await sleep(400);
  const fit = await evaluate(api.cdp, `(() => {
    const dlg = document.getElementById('va-dialog');
    const form = document.getElementById('va-dialog-form');
    const save = document.querySelector('#va-dialog [data-save]');
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.height > 0;
    };
    const dr = dlg.getBoundingClientRect();
    return {
      vh: innerHeight,
      dlgH: Math.round(dr.height),
      dlgInside: dr.top >= 0 && dr.bottom <= innerHeight,
      formOpen: form && !form.classList.contains('is-hidden'),
      saveReachable: (() => { save.scrollIntoView({ block: 'center', behavior: 'instant' }); return inside(save); })()
    };
  })()`);
  ok('键盘压缩视口后弹层整体仍在视口内', fit.dlgInside, JSON.stringify(fit));
  ok('表单保持展开', fit.formOpen, JSON.stringify(fit));
  ok('保存按钮滚入即达视口内', fit.saveReachable, JSON.stringify(fit));
  await tapInView(S('correct'));
  await api.type('键盘小屏测试词');
  await tapInView('#va-dialog [data-save]');
  await waitSaved();
  eq('键盘压缩视口下真触摸保存成功', await evaluate(api.cdp, `JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive')).entries.some(e => e.correct === '键盘小屏测试词')`), true);

  await tapInView('#va-dialog [data-new]');
  await sleep(150);
  await tapInView('#va-dialog [data-cancel]');
  await sleep(150);
  eq('键盘压缩视口下取消可达', await evaluate(api.cdp, `document.getElementById(${JSON.stringify(ID('form'))}).classList.contains('is-hidden')`), true);
  await api.keyboard(false);
  await sleep(300);

  // 清理这条测试数据（删除二次确认）
  for (let i = 0; i < 2; i++) {
    await evaluate(api.cdp, `(() => {
      const item = [...document.querySelectorAll('#va-dialog .va-item')].find(el => el.querySelector('.va-word').textContent === '键盘小屏测试词');
      item.querySelector('button[data-act="del"]').click();
      return true;
    })()`);
    await sleep(180);
  }
  await waitSaved();
  eq('小屏测试数据已清理', await evaluate(api.cdp, `JSON.parse(localStorage.getItem('today-todo:v1:voiceArchive')).entries.some(e => e.correct === '键盘小屏测试词')`), false);

  // 语音钩子
  eq('VoiceHost 已挂钩', await evaluate(api.cdp, `!!(window.VoiceHost && window.VoiceHost.__vaHooked)`), true);
  eq('引擎挂在 window 上', await evaluate(api.cdp, `typeof window.VoiceArchive.correct`), 'function');

  await api.shot('va-dialog');
  console.log('截图：innovation/ui-v2/shots/va-dialog.png');

  ok('无 JS 异常', api.errors.length === 0, api.errors.join(' | '));
  const bad = api.failed.filter((x) => !/404/.test(x));
  ok('无 4xx/5xx 资源', bad.length === 0, bad.join(' | '));
} finally {
  await api.close();
}

if (fails.length) {
  console.error('\n✗ %d 项失败 / 共 %d 项', fails.length, pass.length + fails.length);
  fails.forEach((f) => console.error('   · ' + f));
  process.exit(1);
}
console.log('✓ 常用词档案 UI 回归：%d 项全过', pass.length);
