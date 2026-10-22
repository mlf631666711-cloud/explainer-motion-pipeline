# 自动录屏（Windows）

把"真人操作网页"录成视频，而且**画面里的鼠标是真的**——不是软件光标、不是后期贴上去的。
一条命令：起浏览器 → 量元素坐标 → 开录 → 真鼠标点 → 收片。

```bash
set NODE_PATH=C:\path\to\node_modules          # 需要 puppeteer-core
python rec_web.py --url "https://example.com/setup" --steps my_steps.json --out out/r01.mp4
```

## 为什么不用无头录屏 / 不用软件光标

教学片里观众要看的是"手在哪儿、点了什么"。无头渲染没有鼠标，软件光标是画上去的——两者都会露馅。
这里反过来：**结构归 DOM，手势归 OS，判据归像素**。

| 归谁 | 用什么 | 为什么 |
|---|---|---|
| 结构 | Chrome DevTools（`web_drive.cjs`） | 元素在哪、多大，DOM 说了算；改版也不会点空 |
| 手势 | `SetCursorPos` + `mouse_event`（`mouse.py`） | 真实点击，画面里有真光标，系统会给出真实反应 |
| 判据 | 抓帧找红块（`calib.py`） | 窗口边框、DPI、书签栏都会让"算出来的坐标"偏 8–39px |

## 三件套

```
web_drive.cjs   有头 Chrome：打开页面、取 DOM 矩形、在左上角插一个 12×12 红块
      ↓  rects.json（元素在视口里的位置）
calib.py        抓一帧桌面 → 在图里找红块 → 视口原点（像素级）
      ↓  origin（视口左上角在屏幕上的坐标）
auto_record.py  gdigrab 区域录制 + 按脚本驱动真鼠标
      ↓  mp4
rec_web.py      把上面三步串成一条命令（还负责预热、哨兵、拒录）
```

**为什么要红块**：浏览器的"视口原点"没有 API 能直接问。`outerHeight − innerHeight` 只能估 UI 高度，
书签栏 / 缩放 / DPI 一变就错（实测偏 8–39px）。插一个纯红方块，然后在抓帧里找它——这个位置就是真原点。

## 五个坑（都踩过，全是"零报错的坏"）

| # | 症状 | 真因 | 修法 |
|---|---|---|---|
| 1 | 只录到左上 1/4 | `ShowWindow(SW_MAXIMIZE)` 把窗口撑到 3440 宽，而录制区域是 1920×1080 | 用 `SetWindowPos` 把窗口**钉死**，不最大化 |
| 2 | 坐标对了，点下去没反应，也不报错 | 窗口刚激活时，**第一次点击被系统当成"激活"吃掉** | 开录**之前**在标题栏点一下，把这一下消费掉（不进画面） |
| 3 | 点击位置整体偏 8–39px | 用 `outerHeight−innerHeight` 估浏览器 UI 高度 | 红块 + 像素校准（`calib.py`） |
| 4 | 一开录就在目标 tab，不是初始状态 | 页面把 tab 写进 URL hash，`reload()` 会原样恢复 | 别 reload，用 `goto(url)` 重来 |
| 5 | 录出一段空白错误页，脚本全绿 | 网络抽风时 `page.goto()` **照样返回成功**（返回的是错误页） | 等哨兵（`button,select,a` > 4）+ 重试 3 次 + 目标数 == 0 直接拒录 |

第 2 和第 5 是同一个病：**调用了 ≠ 发生了**。

## 脚本格式（`--steps` 的 JSON）

```json
{
  "prep":  [{"sel":"button.tab-button","idx":1,"wait":1200}],
  "steps": [
    {"sel":"button.tab-button","idx":1,"label":"切到离线安装","wait":1.6},
    {"sel":"select","idx":0,"label":"平台下拉","hover":true,"wait":0.9},
    {"sel":"#download","idx":0,"label":"下载按钮","wait":1.9}
  ]
}
```

- `sel` + `idx`：CSS 选择器与序号；`hover:true` 表示"手移过去但不点"（录下拉/按钮预览）
- `wait`：这一动作后停多久
- `prep`：只在**测量阶段**执行（用来把页面切到目标状态），录制前会重新 `goto` 复位
- 量不到的元素可以给屏幕绝对坐标 `{"x":953,"y":786}`（浏览器自己的 UI，DOM 里没有）

## 能力边界

- **仅 Windows**（`gdigrab` + `user32`）。macOS/Linux 要换采集后端。
- 只能录**本机能打开的东西**。需要真装 3GB 离线包、真插板子、真串口的镜头，机器替不了人。
- 录制期间会**临时关掉系统通知**（`record_mode.ps1`），结束必须还原——脚本已处理。
- 只按 PID 杀自己开的浏览器，**不要** `taskkill /IM chrome.exe`（会杀掉用户自己的窗口）。

## 录完之后的第二步

录屏素材只是原料。要变成讲解段（固定取景框 + 框内推近 + 右栏要点 + 音画对齐），
见 [`../references/recording-enhance.md`](../references/recording-enhance.md)。

---

## English quickstart

Windows-only. Records a real browser session **with a real cursor** (not a software cursor).

```bash
set NODE_PATH=C:\path\to\node_modules        # needs puppeteer-core
python rec_web.py --url "https://example.com/setup" --steps my_steps.json --out out/r01.mp4
```

Three pieces: `web_drive.cjs` (headful Chrome + DOM rects + a red calibration marker) →
`calib.py` (find the marker in a grabbed frame = viewport origin) → `auto_record.py` (region capture + real mouse).
`rec_web.py` chains them into one command, plus warm-up, page sentinel, and refusal to record an error page.

Five pitfalls, all "silent failures": window maximized past the capture region; the first click swallowed by window activation;
viewport origin guessed from `outerHeight−innerHeight` (off by 8–39px); `reload()` restoring a URL-hash tab state;
`goto()` resolving on an error page. Details in the table above.
