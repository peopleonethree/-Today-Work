# 提交说明：修正 README 中 v1.0.68 的 app.js 哈希笔误

| 项 | 内容 |
|---|---|
| 提交哈希 | `be252ac2a32be4e0216c22e3822ba4774f02bc3c` |
| 短哈希 | `be252ac` |
| 提交标题 | `docs(innovation): 修正 README 中 v1.0.68 的 app.js 哈希笔误` |
| 父提交 | `fe5c5fd` |
| 分支 | `main`（已推送至 `origin/main`） |
| 作者 / 时间 | peopleonethree `<1283434234@qq.com>` / 2026-11-27 19:08:50 +0800 |
| 仓库 | https://github.com/peopleonethree/-Today-Work.git |
| 修改规模 | 1 个文件，+1 / −1 |

---

## 一、变更概述

`innovation/ui-v2/README.md` 第 6 行「线上发布版」一处哈希值有误，本次将其改为实测值，**仅此一处，无其它改动**。

```diff
第 6 行：
-- 线上发布版：tag `v1.0.68` → `5b8e55d1…`（styles.css）/ `8111a64b…`（js/app.js）/ `a135992a…`（index.html）
+- 线上发布版：tag `v1.0.68` → `5b8e55d1…`（styles.css）/ `666f8b23…`（js/app.js）/ `a135992a…`（index.html）
```

同行的 `5b8e55d1…`（styles.css）与 `a135992a…`（index.html）经核对是正确的，未作改动；仅替换 `js/app.js` 那一处错值。

### 为什么改

`8111a64b` 在仓库中无法对应到任何实际对象，而 `666f8b23` 有四处一致佐证：

| 佐证来源 | 结果 |
|---|---|
| `git worktree` 检出 tag `v1.0.68` 后实测 `assets/js/app.js` | `666f8b231f60d2101f3dccaa0f49a0947b550a18c967696b118297ca0bbbed7c` |
| `innovation/ui-v2/orig/app.js` | `666f8b23…` |
| `node build.mjs --base` 输出 | `666f8b23…` |
| 旧值 `8111a64b` 在全部对象与提交信息中的命中数 | **0** |

---

## 二、涉及文件

| 文件 | 状态 | 增删 | blob（改前 → 改后） |
|---|---|---|---|
| `innovation/ui-v2/README.md` | 修改 | +1 / −1 | `526e0c3e71c5ee5dd442e90c7fa979d701e8e661` → `526aecf8d2b64efb5c4b016b287574b19c1de234` |

**未包含**（按既有规则不入库，提交前已逐一确认）：

- `innovation/ui-v2/assets/` —— 构建产物，`.gitignore` 忽略
- `voice-session-fix-20261026/node_modules/` —— 依赖目录，`.gitignore` 忽略

---

## 三、提交信息（原文）

```
docs(innovation): 修正 README 中 v1.0.68 的 app.js 哈希笔误

第 6 行「线上发布版」把 js/app.js 的哈希写成了 `8111a64b…`，实际是 `666f8b23…`：

- `git worktree` 检出 tag `v1.0.68`，`assets/js/app.js` = `666f8b231f60d2101f3dccaa0f49a094…`
- `innovation/ui-v2/orig/app.js` 与 `build.mjs --base` 的输出同为 `666f8b23…`（三方一致）
- `8111a64b` 在仓库全部对象与提交信息中 0 命中，确认是笔误

只改这一个哈希，行内其余内容、行数、顺序与行尾均未变（该行改前改后同为 96 字符）。
```

---

## 四、推送目标

| 项 | 值 |
|---|---|
| 远程仓库 | `origin` → https://github.com/peopleonethree/-Today-Work.git |
| 目标分支 | `main` → `refs/heads/main` |
| 推送区间 | `fe5c5fd..be252ac` |
| 推送后远程 main | `be252ac2a32be4e0216c22e3822ba4774f02bc3c` |

`main` 当前为线性历史：

```
be252ac  docs(innovation): 修正 README 中 v1.0.68 的 app.js 哈希笔误   ← 本次
fe5c5fd  docs(innovation): 把本机行尾规则纳入仓库，换机器一条命令可还原
619ddc8  fix(build): 行尾以装机字节为准，避免检出差异导致产物漂移
5ce92ee  创新版本：ui-v2 视觉层源码与验证记录（基于 v1.0.68）（#1）
3d6c374  fix(ui): keep light-theme swatch readable in dark mode
```

---

## 五、关键过程记录

### 1. 修改前的范围核对

```bash
git status --short --branch
# ## main...origin/main
#  M innovation/ui-v2/README.md

git status --porcelain -uall | wc -l        # 1
git diff --cached --name-only               # （空，未预暂存）
git status --porcelain --ignored | grep '^!!'
# !! innovation/ui-v2/assets/
# !! voice-session-fix-20261026/node_modules/
```

### 2. 只改一行的验证

```bash
git diff -U0 innovation/ui-v2/README.md     # 只有 @@ -6 +6 @@ 一个 hunk
diff <(git show HEAD:innovation/ui-v2/README.md | sed '6d') \
     <(sed '6d' innovation/ui-v2/README.md)  # 无差异 → 其余行逐字节相同
```

| 检查项 | 结果 |
|---|---|
| 行数 | HEAD 88 行 / 现在 88 行 |
| 该行字符数 | 改前 96 / 改后 96（两个哈希等长） |
| 行尾属性 | `i/lf  w/crlf`，改前改后一致 |

### 3. 提交

```bash
git add innovation/ui-v2/README.md
git commit -F <message file>                # 信息文件为 UTF-8 LF，无 BOM
git log -1 --format='%H%n%h %s%n父提交 %p'
# be252ac2a32be4e0216c22e3822ba4774f02bc3c
# be252ac docs(innovation): 修正 README 中 v1.0.68 的 app.js 哈希笔误
# 父提交 fe5c5fd
```

### 4. 推送

```bash
git push origin main
# To https://github.com/peopleonethree/-Today-Work.git
#    fe5c5fd..be252ac  main -> main
```

一次成功，未出现重试。

---

## 六、验证结果

| 验证项 | 命令 / 方式 | 结果 |
|---|---|---|
| 远程引用指向 | `git ls-remote origin main` | `be252ac2a32be4e0216c22e3822ba4774f02bc3c  refs/heads/main` |
| 本地与远程一致 | `git rev-list --count` | 领先 0 / 落后 0，`## main...origin/main` 无偏离 |
| 内容一致（blob 级） | `git rev-parse origin/main:…` vs `HEAD:…` | 均为 `526aecf8d2b64efb5c4b016b287574b19c1de234` |
| 远程第 6 行抽检 | `git cat-file -p origin/main:… \| sed -n '6p'` | `… / 666f8b23…（js/app.js）/ …` ✔ |
| 旧值残留 | `grep -c '8111a64b'`（远程 README） | 0 |
| 工作区状态 | `git status --porcelain -uall` | 0 行（干净） |
| 提交树 | `git rev-parse HEAD^{tree}` | `9759226c664c121292f061b76925fe0a315f1ac3` |

---

## 七、注意事项

1. **`666f8b23` 是正确的，不是笔误**。仓库里 `app.js` 有两套哈希容易混淆：tag `v1.0.68` 的发布版是 `666f8b23…`，创新版本（`v1.0.68-ui3`）是 `6362da05…`。提交信息里已写明三方佐证，避免后续被误改回去。
2. **推送时的安全策略提示**：push 命令输出显示 `fe5c5fd..be252ac  main -> main`（成功），随后附带一条「被安全策略拦截」的提示。经只读复核（`git ls-remote`、远程 blob 比对、远程文件内容抽检）确认远程引用已实际更新，判定为命令执行完成后的沙箱事后提示，**推送未失败**；因此未重试，也未做任何重置或改写。
3. **`README.md` 的行尾是 CRLF（工作区）**。该文件未被 `.gitattributes` 逐条 pin，走的是本机 `core.autocrlf=true` 的检出转换（`i/lf w/crlf`）。这是既有状态，与本次改动无关，也未在本次改动。
4. **本次未触碰的范围**：`innovation/ui-v2` 分支、tag `v1.0.68`（`9eeb101`）、tag `v1.0.68-ui3`（`f20e38c`）、应用资源 `voice-session-fix-20261026/assets/*` 均未改动；`build.mjs` 未改动，构建产物哈希不变。
5. **临时文件已清理**：提交信息文件 `tmp/msg3.txt` 在提交后删除，未留在仓库内。
