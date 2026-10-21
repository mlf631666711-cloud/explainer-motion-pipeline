# 版式系统（照这套走就不会像 AI 默认模板）

## 1. 画布与安全区（硬约束）

| 项 | 值 | 说明 |
|---|---|---|
| 画布 | **1920 × 1080 / 30fps** | 渲染时 `deviceScaleFactor:2` 出 3840×2160 |
| 上留白 | **0 – 154px** | 给**进度条 / 章节刻度** |
| 下留白 | **926 – 1080px** | 给**字幕条** |
| 内容区 | **y ∈ [154, 926]** | 任何可见元素不得越界 |
| 横向 | **占满，≥1600px** | 两侧可留 ~150px 编辑边距，**禁止整体缩小居中** |

> 上下留白是"给后期留的物理空间"，不是"我想让画面显得松"。
> 正确做法：**重排内容**塞进 1920×772；错误做法：把 1080 高的画面 `scale(0.7148)`（左右会跟着缩水，变信箱）。

## 2. 栅格与底

- 底：**纸面** `#F7F7F3`（不是纯白，纯白像 PPT）
- 细格：8px（几乎看不见，只提供质感）
- 中格：64px
- 粗格：320px
- 网格整体 `opacity: .55–.62`，并给 `class="meter"`（闸门不把它算内容）

```css
#grid{position:absolute;inset:0;background-image:
 linear-gradient(#D2D8E1 1px,transparent 1px),linear-gradient(90deg,#D2D8E1 1px,transparent 1px),
 linear-gradient(#B9C1CD 1px,transparent 1px),linear-gradient(90deg,#B9C1CD 1px,transparent 1px);
 background-size:64px 64px,64px 64px,320px 320px,320px 320px;opacity:.6}
```

## 3. 字阶（五档，禁新增）

| 档 | 字号 | 用途 |
|---|---|---|
| 巨 | 96–104px | 一屏主标题（最多 2 行） |
| 大 | 50–54px | 段落标题 / 页面主标 |
| 中 | 36–40px | 卡片主字、条目 |
| 小 | 24–28px | 副标、说明 |
| 微 | 20–22px | 序号、单行注脚（**慎用，能删就删**） |

- 字重只用 **800（标题）/ 500（正文）/ 400（说明）** 三档
- 字距：大字号 `-1 ~ -4px`（收紧才像设计过），小字号 `0`
- **不要**给正文加粗、加色、加底纹来表示"重点"——重点靠**位置和大小**

## 4. 色彩（1 底 + 1 墨阶 + 1 强调）

```css
--paper:#F7F7F3;  /* 底 */
--ink:#16181C;    /* 墨：主文字/边框/深色块 */
--ink2:#5A6068;   /* 次级文字 */
--ink3:#9AA0A8;   /* 弱化/未激活 */
--rule:#D2D8E1; --rule2:#B9C1CD;  /* 网格线 */
--sig:#C8342A;    /* 强调：朱红。一屏最多 3 处，且必须是"当前这一句的主角" */
```

> 不要第二个强调色。需要区分时用**墨色块**（反白）而不是换颜色。

## 5. 两种"块"（本系统的招牌）

**① 硬边卡**：白底 + 3px 墨边 + 硬投影（不带模糊）

```css
.card{background:#fff;border:3px solid var(--ink);box-shadow:8px 8px 0 rgba(22,24,28,.12)}
.card.dark{background:var(--ink);color:#fff}
```

**② 框 + 挂绳标签**：右侧一条竖的色块当标签，写编号

```css
.tip{background:#fff;border:3px solid var(--ink);box-shadow:9px 9px 0 rgba(22,24,28,.14);padding:18px 30px 18px 20px}
.tip .tab{position:absolute;right:-19px;top:-19px;bottom:-19px;width:56px;background:#1F4FD8;
 border:3px solid var(--ink);display:flex;align-items:center;justify-content:center;color:#fff;font-family:ui-monospace,monospace}
```

## 6. 实拍/产品图处理

- 官方产品图多为**白底 PNG/JPG** ⇒ 用 ffmpeg 键出透明：
  ```bash
  ffmpeg -i in.jpg -vf "colorkey=0xFFFFFF:0.09:0.03,format=rgba" -frames:v 1 out.png
  ```
- **按不透明包围盒对齐**，不要按图片画布对齐（白底图四周有大量留白，会显得元素偏小/偏上）：
  ```python
  from PIL import Image
  bb = Image.open(p).convert('RGBA').split()[3].getbbox()   # 再按显示宽度换算
  ```
- 示意图（找不到真图）**必须画成线稿并标"示意"**，不许画得"像真的"。
- 商标：Wi-Fi / 蓝牙 logo 不许贴近设备（商标政策）；不确定就自绘符号。

## 7. 命名与目录

```
项目/
├── 单集/01/动画/S01-重建.html        ← 一镜一页，"重建"= 最终版，草稿另名
├── 单集/01/成片/S01-4K.mp4
└── 素材/录屏/r01-xxx.mp4             ← 原始素材只读
```
- 页面里 `window.DUR` 必须与配音时长一致（±0.02s），命名与配音段号对齐（`S04` ↔ `seg04.mp3`）
- **配对表写在文档里**：错位一格会废掉整批（真实事故）
