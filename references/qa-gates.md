# 双闸：判据、阈值、以及"判据自己骗人"的四种方式

> 两把尺分工明确：
> **density_check** 答"画面在不在变"；**safe_check** 答"内容在不在框里、够不够满"。
> 两个都 PASS 只是**及格线**，好不好看还得抽帧用眼睛过。

---

## 1. 门的契约（页面必须满足）

| 契约 | 说明 |
|---|---|
| `#stage` 1920×1080 | 所有内容都在里面 |
| `window.DUR` | 秒，闸门靠它决定采样范围 |
| `function render(t)` + `window.render` | **纯函数**：只依赖 t。闸门每帧调它 |
| 计量件 `class="meter"` | 网格/进度线/水印：只报读数，**不算内容事件** |

---

## 2. density_check —— "在动吗"

```bash
node scripts/density_check.cjs "S04-重建.html"            # 人读
node scripts/density_check.cjs "S04-重建.html" --json d.json  # 机器读（含 perFrame）
```

| 读数 | 判据 | 抓什么病 |
|---|---|---|
| 可见对象数 | **≥12** | 空屏、元素没显示 |
| 内容事件/秒 | **≥3** | 元素进完就定住 |
| 内容静默最长 | **≤1.2s** | 长死帧 |

**怎么算"内容事件"**：逐帧对比每个可见元素的 `rect / opacity / 颜色 / 文本`——变了就 +1。
**计量件除外**：`grid`、`endline`、`.meter` 的变化不计入内部事件，否则一条全程进度线就能把静默"填平"。

---

## 3. safe_check —— "在框里 / 够不够满"

```bash
node scripts/safe_check.cjs "S04-重建.html" --step 0.5
```

| 判据 | 阈值 |
|---|---|
| 竖向 | 任一时间点，可见元素**有效矩形** ∈ `y∈[154,926]` |
| 横向 | 整段内容包围盒 **≥1600px**（1920 的 83%） |

**"有效矩形"** = 自身矩形 ∩ 所有 `overflow:hidden/clip/auto/scroll` 祖先的矩形。
全屏底图（`#grid`）与 `svg/canvas` 容器不参与判定。

**为什么横向阈值是 1600 不是 1920**：版式本来就需要 ~150px 编辑边距，逼到贴边只会更难看；
但"整体缩小居中"只剩 1372（71%），必须拦下。

---

## 4. 判据骗人的四种方式（都真实发生过）

| 骗法 | 症状 | 防法 |
|---|---|---|
| **把计量件当内容** | 进度线每帧变宽 ⇒ 静默永远 0.0s，实际空屏 | 计量件必须显式标记并被排除 |
| **自己维护状态** | 递归里 clip 被覆盖，`walk()` 返回空 ⇒ 越界 6 个报 0 个 | 用「元素 ∩ 祖先」一次性算，别攒状态 |
| **只测一个维度** | 只测竖向 ⇒ "整体 scale 居中"全 PASS | 每个维度都要有独立判据 |
| **拿自己跟自己比** | 阈值 0 或"和上一版相同" ⇒ 天然通过 | 上线前造一个**必定失败**的负控跑一遍 |

**负控做法**：
- 密度闸：把 `render` 改成 `function render(t){}`（永远不动）⇒ 必须 FAIL
- 安全闸：把某个元素 `top` 改到 `-50px` ⇒ 必须报越界
- 横向：把 `#stage` 包一层 `transform:scale(0.71)` ⇒ 必须报"左右没占满"

---

## 5. 常见"真·误报"与处理

| 现象 | 原因 | 处理 |
|---|---|---|
| 标题明明在框内却报越界 | 行内 `<em>` 的行盒比内容盒高 | `em{display:inline-block;vertical-align:top;line-height:1}` |
| 入场动画前 0.5s 报越界 | 元素从 `-42px` 飞入 | 容器加 `overflow:hidden` 当遮罩 |
| 全屏 SVG 报越界 | 容器本身就是全屏 | 已按 tagName 跳过，别把内容画在容器上 |
| 隐藏元素报越界 | `opacity` 已置 0 但没 `display:none` | 闸门按 `opacity<0.15` 过滤；渲染时用 `visibility` 更保险 |
| 一镜 20 秒采样太慢 | step 太小 | 先 `--step 1.5` 粗扫，有问题再 `--step 0.25` |

---

## 6. 渲染后的"第二道验收"（脚本管不了）

```bash
node scripts/render.cjs "S04-重建.html" 9.82 seg04.mp3 "../成片/S04-4K.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 "../成片/S04-4K.mp4"
ffprobe -v error -select_streams v -show_entries stream=width,height,nb_frames -of csv=p=0 "../成片/S04-4K.mp4"
node scripts/probe.cjs "S04-重建.html" "2.0,5.0,8.6" _p   # 抽 3 帧用眼睛过
```

**必查三项**：时长对得上配音、分辨率 3840×2160、有音轨（`aac`）。
**连渲 6 段以上 Chrome 会掉**（`TargetCloseError`），产物可能还是旧的 ⇒ `ls -la --time-style=+%H:%M` 对时间戳。
