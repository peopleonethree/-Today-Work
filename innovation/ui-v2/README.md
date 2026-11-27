# 创新版本：ui-v2 视觉层

这是「今日待办」的**创新版本**（不改功能，只重做视觉层与交互手感）。它建立在已发布的
`v1.0.68`（tag，提交 `9eeb101`）之上，与旧版本并存，互不影响。

- 线上发布版：tag `v1.0.68` → `5b8e55d1…`（styles.css）/ `8111a64b…`（js/app.js）/ `a135992a…`（index.html）
- 创新版本：tag `v1.0.68-ui3` → `9fddf943…` / `6362da05…` / `e6e9184a…`（见下方「构建产物」）

## 做了什么

1. **视觉层重做**：按钮/卡片/分段控件统一为一层表面 + 一根细线，去掉渐变与内高光；配色仍是
   浅色 / 深色 / 马卡龙三套。
2. **修掉一个 P1 性能回归**：v2 层给所有按钮加的全局过渡里带了 `color`（可继承，换主题时
   每个子节点逐帧重算）和 `border-color`（展开成四条），一次换主题会在同一帧拉起上百条过渡。
   修法是去掉这两个属性，并在换主题的两帧内用 `html.is-retheming` 关掉全部过渡。
   实测：换主题任务耗时 +62% → −14%，时光胶囊/排序 +63% → −4%，>100ms 长帧 42 → 13。
3. **修掉深色模式下主题预览块看不清**：「浅色」预览块是白底，字色却取了 `var(--text)`，
   深色模式下变成近白字配白底（1.13:1）。改为固定深墨色并分别钉住悬停/按下/聚焦三态，
   现在 9.92–12.59:1（AAA）。

## 构建（可逐字节复现）

`orig/` 是 `v1.0.68` 的冻结前端原件，`patches/` 是本层唯一的改动来源，产物由脚本拼接生成：

```bash
cd innovation/ui-v2
node build.mjs                 # orig + patches → assets/
sha256sum -c assets.sha256     # 三项必须全部 OK
node verify-expand.mjs         # :is() 展开一致性，应为「不一致 0」
```

`assets/` 是生成物，不入库；比对 `assets.sha256` 即知字节是否正确。

### 历史 tag 的行尾（本机规则）

`v1.0.68` 的树里没有 `.gitattributes`（那是后来的提交才加的），在 `core.autocrlf=true` 的
机器上检出它时，`styles.css` / `index.html` 会被转成 CRLF，哈希校验必然失败
（实测 `d345b23c…` / `78448a97…`，而非发布版的 `5b8e55d1…` / `a135992a…`）。

`.git/info/attributes` 优先级最高、且不随 commit 走，所以修法是把它装到本机。这份内容已随仓库
提交为 `git-attributes.local`，换机器时一条命令即可还原：

```bash
cp innovation/ui-v2/git-attributes.local .git/info/attributes
git check-attr eol -- voice-session-fix-20261026/assets/styles.css   # 应输出 eol: lf
```

不想改配置也行，直接用 `git -c core.autocrlf=false clone …` 检出历史 tag。

构建产物（也是装进手机的字节）：

```
9fddf9439c8e1d14… *styles.css      （v1.0.68-ui2 版为 d194f944…）
6362da05bd64084c… *js/app.js
e6e9184a991de1d7… *index.html
```

把这三个文件放进 `voice-session-fix-20261026/assets/` 对应位置，即为创新版本的前端；
仓库里这份已经是更新后的状态。

## 目录

| 路径 | 说明 |
|---|---|
| `orig/` | `v1.0.68` 的冻结前端原件，**不要改**；改它等于改基线 |
| `patches/ui-v2.css` | 视觉层全部 CSS，追加到 `styles.css` 末尾 |
| `patches/kb-stable.js` | 键盘避让 + 换主题标记，追加到 `app.js` 末尾 |
| `build.mjs` | 拼接 + `:is()` 展开；`--base` 可还原为原件 |
| `verify-expand.mjs` | 校验展开后的选择器与源一致 |
| `stress.mjs` | 压力测试（场景化：切页、换主题、时光胶囊、滚动…） |
| `themecheck.mjs` | 换主题专项：单次时延、连点掉点、真实触屏命中（`--unfix` 可注入旧规则做对照） |
| `contrastcheck.mjs` | 按钮各状态文字对比度（CDP 强制伪类 + 计入 `brightness()` 滤镜） |
| `lib/` | 上面几个脚本共用的 CDP 客户端与会话封装，浏览器路径写死在 `lib/cdp.mjs` |
| `assets.sha256` | 构建产物的 sha256 清单 |
| `测试报告.md` | 完整测试报告（含基线对比、真机复核、装机记录） |

## 不纳入仓库的东西

体积大或与本机绑定的，都在 `.gitignore` 里：`assets/`（生成物）、`profile/`（浏览器配置）、
`results/`、`shots/`、`install/`（APK 与中间文件，`*.apk` 全局忽略）。安装包不入库，
需要时用 `python install/pack.py <后缀>` 以 `v1.0.68` 原包为底重打。

## 回退

创新版本不碰 `v1.0.68` 的内容，回退有两条路：

- 源码层：`git switch main` 或 `git checkout v1.0.68`。
- 手机层：`adb install -r` 原版 APK 覆盖即可，`versionCode` 始终是 69，不用卸载、不丢数据。
