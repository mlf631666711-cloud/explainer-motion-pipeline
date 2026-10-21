#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""calib.py —— 从一帧桌面截图里找出红色定位标记，把「视口坐标」换算成「屏幕坐标」。

为什么要有这一步：窗口边框/标题栏/书签栏的高度靠 outerHeight-innerHeight 估不准
（实测偏 39px，点空而且不报错）。红标是被 Chrome 真实渲染出来的像素，
它在屏幕上的位置就是视口原点 —— **用像素当尺子，不用 API 的说法当尺子**。

用法：
  python calib.py --rects _rects.json --raw _calib.raw --out _r01_rec.json [--margin 1.2]

输出：直接生成 auto_record.py 能吃的动作脚本（含 focus 固定窗口矩形）。
"""
import argparse
import os
import json
import subprocess
from pathlib import Path

FF = os.environ.get("FFMPEG") or "ffmpeg"   # 环境变量优先，否则用 PATH 里的
W, H = 1920, 1080


def grab_raw(raw_path, region="0,0,1920,1080"):
    """抓一帧桌面，存成裸 RGB24 —— 不依赖 PIL。"""
    x, y, w, h = [int(v) for v in region.split(",")]
    png = str(raw_path).replace(".raw", ".png")
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-f", "gdigrab",
                    "-offset_x", str(x), "-offset_y", str(y), "-video_size", f"{w}x{h}",
                    "-framerate", "1", "-i", "desktop", "-frames:v", "1", png], check=True)
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", png,
                    "-f", "rawvideo", "-pix_fmt", "rgb24", str(raw_path)], check=True)
    return Path(raw_path).read_bytes(), w, h


def find_red(buf, w, h):
    """找 12×12 纯红块，返回它的左上角；找不到返回 None。"""
    for yy in range(0, h, 1):
        row = yy * w * 3
        for xx in range(0, w, 1):
            i = row + xx * 3
            r, g, b = buf[i], buf[i + 1], buf[i + 2]
            if r > 240 and g < 24 and b < 24:
                # 校验：右侧 8px、下侧 8px 也得是红的（防截图里的红色按钮冒充）
                def red_at(dx, dy):
                    j = (yy + dy) * w * 3 + (xx + dx) * 3
                    return buf[j] > 240 and buf[j + 1] < 24 and buf[j + 2] < 24
                if red_at(8, 0) and red_at(0, 8) and red_at(8, 8):
                    return xx, yy
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rects", required=True)
    ap.add_argument("--raw", default="_calib.raw")
    ap.add_argument("--out", required=True)
    ap.add_argument("--margin", type=float, default=1.2, help="开头留白秒数")
    a = ap.parse_args()

    buf, w, h = grab_raw(a.raw)
    ox, oy = find_red(buf, w, h), None
    if ox is None:
        raise SystemExit("没找到红色标记 —— 页面没起来 / 被别的窗口挡住 / 标记没插进去")
    ox, oy = ox
    print(f"[calib] 红标在屏幕 ({ox},{oy}) ⇒ 视口原点实测；窗口偏移误差 = {ox - 8:+d}px / {oy - 95:+d}px")

    J = json.loads(Path(a.rects).read_text(encoding="utf-8"))
    steps = []
    title = "ESP-IDF Installation Manager"
    for s in J["steps"]:
        if not s.get("found") or not s.get("visible"):
            continue
        steps.append({"sel": s["sel"], "idx": s.get("idx", 0),
                      "x": ox + s["cx"], "y": oy + s["cy"], "label": s.get("label")})
    Path(a.out.replace(".json", "_calib.json")).write_text(
        json.dumps({"origin": [ox, oy], "steps": steps}, ensure_ascii=False, indent=1), encoding="utf-8")
    for s in steps:
        print(f"  {s['label']} → 屏幕 ({s['x']},{s['y']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
