// 常用词档案：引擎单测（不需要浏览器，也不需要 DOM）
//   node tools/test-voice-archive.mjs
// 把 patches/voice-archive.js 当脚本求值，只取它导出的纯函数跑断言；
// 拼音表直接复用 assets/js/name-pinyin.js（与真机同一份数据）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = (file, sandbox) => {
  const src = readFileSync(join(ROOT, file), 'utf8');
  new Function('window', src)(sandbox);
  return sandbox;
};

// 没有 document 的环境：补丁会只导出引擎、不挂 DOM
const sandbox = {};
run('assets/js/name-pinyin.js', sandbox);
run('patches/voice-archive.js', sandbox);
const VA = sandbox.VoiceArchive;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  →  ' + extra : ''));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, '实得 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}

const entry = (o) => Object.assign({
  id: o.id || 'e-' + (o.correct || ''),
  kind: 'term', correct: '', wrong: [], scene: '', accent: '', note: '',
  enabled: true, hits: 0, lastHitAt: 0, source: 'manual', createdAt: 0, updatedAt: 0
}, o);

/* ---------- 一、误识别精确替换 ---------- */
{
  const list = [entry({ correct: '毕设实物', wrong: ['避设实物', '必设实物'] })];
  const r = VA.correct('明天带避设实物去实验室', list);
  eq('B1 精确替换命中', r.text, '明天带毕设实物去实验室');
  eq('B1 命中条目数', r.applied.length, 1);
  eq('B1 记录 from/to', r.applied[0].from + '→' + r.applied[0].to, '避设实物→毕设实物');

  const r2 = VA.correct('必设实物和避设实物都要', list);
  eq('B1 同一条多写法都替换', r2.text, '毕设实物和毕设实物都要');
  eq('B1 同一条只记一次（不刷计数）', r2.applied.length, 1);

  const single = [entry({ correct: '毕设', wrong: ['毕'] })];
  eq('单字误识别不参与（避免误伤）', VA.correct('毕业设计', single).text, '毕业设计');
}

/* ---------- 二、拼音同音 ---------- */
{
  const list = [entry({ correct: '欧阳明宇', kind: 'person' })];
  const r = VA.correct('通知欧阳明雨开会', list);
  eq('B2 同音不同字自动纠正', r.text, '通知欧阳明宇开会');
  eq('B2 命中 1 处', r.applied.length, 1);

  const self = VA.correct('通知欧阳明宇开会', list);
  eq('B2 已是正确写法不误动', self.text, '通知欧阳明宇开会');
  eq('B2 不计数', self.applied.length, 0);

  const latin = [entry({ correct: 'Kubernetes', kind: 'term' })];
  eq('非汉字条目不参与拼音匹配', VA.correct('用 kubernetes 部署', latin).text, '用 kubernetes 部署');
}

/* ---------- 三、口音近音（accent 开关） ---------- */
{
  const plain = [entry({ correct: '陈星云', kind: 'person' })];
  eq('B3 无口音标记：前后鼻音不纠', VA.correct('程星云来了', plain).text, '程星云来了');

  const accent = [entry({ correct: '陈星云', kind: 'person', accent: '前后鼻音不分' })];
  const r = VA.correct('程星云来了', accent);
  eq('B3 有口音标记：cheng/chen 归并后命中', r.text, '陈星云来了');
  eq('B3 命中 1 处', r.applied.length, 1);

  eq('loosen zhang → zan', VA.loosen('zhang'), 'zan');
  eq('loosen cheng → cen', VA.loosen('cheng'), 'cen');
  eq('loosen ning → lin', VA.loosen('ning'), 'lin');
  eq('loosen shi 不变', VA.loosen('shi'), 'si');
}

/* ---------- 四、开关与空档案 ---------- */
{
  const list = [entry({ correct: '毕设实物', wrong: ['避设实物'] })];
  const off = VA.correct('带避设实物', list, { auto: false });
  eq('B4 总开关关闭原样返回', off.text, '带避设实物');
  eq('B4 标记 off', off.off, true);

  const empty = VA.correct('随便一句话', []);
  eq('B5 空档案原样返回', empty.text, '随便一句话');
  eq('B5 空档案无命中', empty.applied.length, 0);

  const disabled = [entry({ correct: '毕设实物', wrong: ['避设实物'], enabled: false })];
  eq('A4 停用条目不参与', VA.correct('带避设实物', disabled).text, '带避设实物');
}

/* ---------- 五、两条档案互相不打架 ---------- */
{
  const list = [
    entry({ id: 'a', correct: '避设实物' }),
    entry({ id: 'b', correct: '毕设实物', wrong: ['必设实物'] })
  ];
  const r = VA.correct('带避设实物去', list);
  eq('A 已是另一条的正确写法时不被改写', r.text, '带避设实物去');
}

/* ---------- 六、纠正沉淀的差量约束 ---------- */
{
  eq('C 单点替换', JSON.stringify(VA.diffPair('带张山去开会', '带张珊去开会')), '{"from":"张山","to":"张珊"}');
  eq('C 无改动返回 null', VA.diffPair('一样的话', '一样的话'), null);
  eq('C 纯增字不学', VA.diffPair('带张山去', '带张山去开会'), null);
  eq('C 纯删字不学', VA.diffPair('带张山去开会', '带张山去'), null);
  eq('C 大段重写不学', VA.diffPair('一二三四五六七八九十一二三', '完全不同的另一句话在这里'), null);
  eq('C 纯标点差异不学', VA.diffPair('明天的会', '明天的会。'), null);
  eq('C 中英混排可学', JSON.stringify(VA.diffPair('用库博内特斯部署', '用Kubernetes部署')),
    '{"from":"库博内特斯","to":"Kubernetes"}');
}

/* ---------- 七、批量解析 ---------- */
{
  const items = VA.splitBulk('1. 欧阳明宇 | 欧阳明雨、欧阳明语\n3、毕设实物\n123\n\n李娜');
  eq('D2 解析条数', items.length, 3);
  eq('D2 首条正确写法', items[0].correct, '欧阳明宇');
  eq('D2 首条误识别', items[0].wrong.join('/'), '欧阳明雨/欧阳明语');
  eq('D2 行首序号不残留', items[1].correct, '毕设实物');
  eq('D2 纯数字行丢弃', items[2].correct, '李娜');
  eq('D2 类型猜测（2–4 汉字→人名）', items[0].kind, 'person');
}

/* ---------- 八、落盘往返（无 AppStorage 时走内存） ---------- */
{
  const res = VA.mergeEntries([{ correct: '测试词甲', wrong: ['测试词假'], kind: 'term', source: 'import' }]);
  eq('A1 合并新增 1 条', res.added, 1);
  const again = VA.mergeEntries([{ correct: '测试词甲', wrong: [], kind: 'term' }]);
  eq('A1 同答案不重复新增', again.added, 0);
  eq('A1 同答案计入跳过', again.skipped, 1);
  const data = VA.load();
  eq('A1 落盘后有 1 条', data.entries.length, 1);
  eq('A1 误识别一并落盘', data.entries[0].wrong.join(''), '测试词假');
  eq('A1 默认开自动纠错', data.settings.auto, true);

  const learned = VA.learn({ from: '张山', to: '张珊' });
  eq('C 沉淀新建条目', learned && learned.correct, '张珊');
  eq('C 沉淀把误识别写进 wrong', VA.load().entries[1].wrong.join(''), '张山');
  eq('C 沉淀来源标 learn', VA.load().entries[1].source, 'learn');

  const before = VA.load().entries.length;
  VA.learn({ from: '张珊珊', to: '张珊' });
  eq('C 同答案改为补误识别而不是新建', VA.load().entries.length, before);
  eq('C 补充的误识别', VA.load().entries[1].wrong.join('/'), '张山/张珊珊');

  ok('导出格式一行一条', VA.exportText().split('\n').length === VA.load().entries.length,
    VA.exportText());
}

/* ---------- 汇总 ---------- */
if (fails.length) {
  console.error('\n✗ %d 项失败 / 共 %d 项：', fails.length, pass + fails.length);
  fails.forEach((f) => console.error('   · ' + f));
  process.exit(1);
}
console.log('✓ 常用词档案引擎：%d 项断言全过', pass);
