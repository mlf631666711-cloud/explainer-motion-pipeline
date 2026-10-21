# 动效语汇 · 十二式（可直接抄的代码）

> 每个镜头 3–7 个动作就够。**动作服务语义：入场（从哪来）→ 强调（哪一下）→ 收尾（停在哪）。**
> 下面所有代码都基于这六个缓动函数，先粘进页面：

```js
var W=1920,H=1080,DUR=12.0;                       // 契约：必须与配音时长一致
function cl(x){return x<0?0:(x>1?1:x);}           // 夹取
function sm(x){x=cl(x);return x*x*x*(x*(x*6-15)+10);}   // 平滑（最常用）
function eo(x){x=cl(x);return 1-Math.pow(1-x,3);}       // 减速（落位/推近）
function eio(x){x=cl(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;} // 两头慢（划线/扫过）
function ob(x){x=cl(x);var c=1.70158;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2);} // 回弹（落位）
function seg(t,a,b){return (t-a)/(b-a);}           // 取区间进度
```

---

## 1 · 遮罩滑入（标题/关键词进场）

**用途**：大标题、关键词从"下方滑出"，比淡入高级得多。
**参数**：`0.45–0.6s`，`translateY(102%) → 0`。

```css
.ln{display:block;overflow:hidden;height:94px}   /* 高度=行高 */
.ln>span{display:block;transform:translateY(104%)}
```
```js
L1.style.transform = 'translateY(' + ((1-sm(seg(t,0,.5)))*104).toFixed(1) + '%)';
```
> 别怎么用：容器高度写成 `auto`，遮罩就失效；`height` 必须等于行高。

## 2 · 错峰落位（一组卡/一组标签）

**用途**：3–6 个元素成组出现。
**参数**：组内 `0.12–0.20s`；**组与组之间按语义断开**（0.4s 以上）。

```js
for (var i=0;i<ITEMS.length;i++){
  var a = cl(seg(t, T0 + i*0.14, T0 + i*0.14 + 0.5));
  ITEMS[i].style.opacity = sm(a);
  ITEMS[i].style.transform = 'translateY(' + ((1-ob(a))*36).toFixed(1) + 'px)';
}
```
> 别怎么用：`i*0.5` 排成一串 —— 那是节拍器。

## 3 · 落位回弹

**用途**：卡片、按钮"砸"到位。
**参数**：`ob()` + `scale 0.94→1`，`0.4–0.5s`。

```js
el.style.transform = 'translateY(' + ((1-ob(a))*40).toFixed(1) + 'px) scale(' + (0.94+0.06*ob(a)).toFixed(3) + ')';
```

## 4 · 点亮（最值钱的一式）

**用途**：讲到一个东西时，把它从"灰"变"亮"。
**要点**：**四个通道同时变**，只改颜色是"变色"不是"点亮"。

```js
var lit = sm(seg(t, T, T+0.34));
el.style.borderColor = lit > .5 ? 'var(--sig)' : 'var(--ink)';
el.style.boxShadow   = '0 0 0 ' + (7*lit).toFixed(1) + 'px rgba(200,52,42,' + (0.15*lit).toFixed(2) + '),10px 10px 0 rgba(22,24,28,.14)';
el.style.filter      = 'saturate(' + (0.52+0.42*lit).toFixed(2) + ')';
el.style.transform   = 'scale(' + (1+0.022*lit).toFixed(3) + ')';
```
> 未点亮的元素压到 0.7 亮度/0.5 饱和，点亮瞬间才有"亮起来"的感觉。

## 5 · 划线（下划线/强调条）

**用途**：标题下的一道红线、进度、覆盖条。
**参数**：`eio`，`0.7–1.0s`。

```js
UL.style.width = (490*eio(seg(t,0.58,1.36))).toFixed(1) + 'px';
```

## 6 · 路径绘制

**用途**：连接线、弧线、括号。
**参数**：`strokeDasharray = 总长`，`strokeDashoffset` 从总长→0。

```js
function initPath(el){var L=el.getTotalLength();el.style.strokeDasharray=L;el.style.strokeDashoffset=L;el.dataset.len=L;}
ARCP.style.strokeDashoffset = (ARCP.dataset.len*(1-eio(seg(t,1.0,2.2)))).toFixed(1);
```

## 7 · 数字滚动 / 点阵填充

**用途**：进度、覆盖率、"100+ 示例"。
**要点**：数字和图形**同步**，别一个先到一个后到。

```js
var p = cl(seg(t,12.1,13.4));
NUM.textContent = Math.round(100*eio(p)) + '%';
for (var d=0; d<100; d++) DOTS[d].style.background = d < 100*eio(p) ? 'var(--sig)' : '#DEDED4';
```

## 8 · 框内推镜（录屏/大图）

**用途**：录屏、产品图，想强调某处又不想整体放大。
**要点**：**取景框固定**，只改框内 `transform`，并**夹紧中心**防止露白边。

```css
#win{overflow:hidden}
#cam{transform-origin:0 0}
```
```js
var s = 1 + 0.36*eio(seg(t,3.2,5.2));
var cx = Math.max(HW/s, Math.min(WINW-HW/s, camX));   // 夹紧，防白边
var cy = Math.max(HH/s, Math.min(WINH-HH/s, camY));
cam.style.transform = 'translate(' + (HW-cx*s) + 'px,' + (HH-cy*s) + 'px) scale(' + s + ')';
```

## 9 · 分屏滑移（换章节）

**用途**：2–4 个并列章节逐页推进。
**要点**：轨道 `translateX(-n*页宽)`，视窗宽度**略小于页宽**（否则下一页会露 7px 边）。

```js
var u = eio(seg(t, PAGE_T[i], PAGE_T[i]+0.85));
TRACK.style.transform = 'translateX(' + (PAGE_X[i-1] + (PAGE_X[i]-PAGE_X[i-1])*u).toFixed(1) + 'px)';
```

## 10 · 迁移线 / 扫过

**用途**：表示"从 A 到 B"、"适用于全系"。
**要点**：线扫到哪里，哪里的节点跟着变红 —— **有因果，不是各动各的**。

```js
var f = eio(seg(t,9.2,11.5));
MIG.style.width = (1380*f).toFixed(1) + 'px';
for (var j=0;j<4;j++) if (300+1380*f >= POS[j]) PTS[j].className = 'pt on';
```

## 11 · 括号收拢（"这些都算一类"）

**用途**：把一排元素括起来说"同一套"。
**参数**：括号从中间往两边长，或从左到右扫，`0.8–1.2s`，随后标签淡入。

```js
BRK.style.width = (1380*eio(seg(t,6.95,8.35))).toFixed(1) + 'px';
LAB.style.opacity = sm(seg(t,8.40,8.86));
```

## 12 · 收尾定格

**用途**：一镜的最后一拍。
**要点**：最后一个动作**减速到 0**，然后至少 hold `0.5s`，别在片尾还在动。

```js
var f = eio(seg(t, DUR-1.6, DUR-0.6));   // 动作在结束前 0.6s 停住
```

---

## 节奏配方（直接照抄）

| 镜头长度 | 结构 | 例子 |
|---|---|---|
| 8–10s | 标题 → 主体落位 → 点亮 1 次 → hold | 概念解释 |
| 12–15s | 标题 → 三段错峰 → 划线/括号 → hold | 列举、谱系 |
| 18–23s | 标题 → 4–6 段（每段 3–4s，段内 1 个强调） → 收尾 | 流程、SDK 构成 |

**每 3–5 秒必须出现一个新信息**（新元素 / 新点亮 / 新位移），否则观众会走神。
**两段之间留 0.2–0.4s 呼吸**，不要首尾相连。
