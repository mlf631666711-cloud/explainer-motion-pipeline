#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""win_pos.py —— 把窗口钉成指定矩形（幂等 · 已达标就秒回）

为什么单独成文件：`auto_record.focus(size,pos)` 每次都调 SetWindowPos，
而 SetWindowPos 要等目标窗口的 UI 线程 —— VS Code 忙时能挂 3 分钟且零输出（RC-007）。
本脚本先读当前 rect，**已经在目标位置/尺寸就直接返回**，不碰 Win32 写接口。

用法：
    python win_pos.py "Visual Studio Code" 0,0,1920,1080
    python win_pos.py "Visual Studio Code" --show      # 只打印，不改
"""
import sys, time, ctypes
from ctypes import wintypes

u = ctypes.windll.user32
try:                      # 必须在任何坐标 API 之前，否则拿到的是缩放后的假值
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try: u.SetProcessDPIAware()
    except Exception: pass

CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)


def find(title):
    hits = []
    def cb(h, _):
        n = u.GetWindowTextLengthW(h)
        if n and u.IsWindowVisible(h):
            b = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, b, n + 1)
            if title.lower() in b.value.lower():
                hits.append((h, b.value))
        return True
    u.EnumWindows(CB(cb), 0)
    return hits[0] if hits else (None, None)


def rect(h):
    r = wintypes.RECT()
    u.GetWindowRect(h, ctypes.byref(r))
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    title = sys.argv[1]
    h, name = find(title)
    if not h:
        print("NOT FOUND:", title); return 1
    cur = rect(h)
    print("window:", name)
    print("current rect:", cur)
    if len(sys.argv) < 3 or sys.argv[2] == '--show':
        return 0
    x, y, w, hh = [int(v) for v in sys.argv[2].split(',')]
    want = (x, y, w, hh)
    if cur == want:
        print("already at target — skip SetWindowPos (0ms)")
        return 0
    # SWP_NOACTIVATE=0x0010：不改焦点，避免打断录制前的前台窗口
    u.SetWindowPos(h, 0, x, y, w, hh, 0x0010)
    time.sleep(0.45)
    print("after rect:", rect(h))
    return 0


if __name__ == '__main__':
    sys.exit(main())
