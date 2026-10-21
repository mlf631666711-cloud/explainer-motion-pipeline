#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mouse.py —— 录屏用的「人手」：移动 / 点击 / 滚动，带缓动与微抖。

为什么要自己写：录教程时鼠标要是"瞬移"，一眼就是脚本；
人手有三个特征 —— 加速再减速、走弧线、停之前有一点点回拉。
"""
import ctypes
import ctypes.wintypes as wt
import math
import random
import time

u = ctypes.windll.user32


def pos():
    p = wt.POINT()
    u.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


def move(x, y, dur=0.7, curve=0.12):
    """缓动移动，路径带一点弧（不是直线）。curve=0 就是直线。"""
    x0, y0 = pos()
    n = max(8, int(dur * 60))
    mx, my = (x0 + x) / 2, (y0 + y) / 2
    dx, dy = -(y - y0), (x - x0)          # 法向
    L = math.hypot(dx, dy) or 1
    ox, oy = dx / L * curve * L * 0.1, dy / L * curve * L * 0.1
    for i in range(1, n + 1):
        t = i / n
        e = t * t * (3 - 2 * t)            # smoothstep：起停都软
        bx = x0 + (x - x0) * e + ox * math.sin(math.pi * e)
        by = y0 + (y - y0) * e + oy * math.sin(math.pi * e)
        u.SetCursorPos(int(bx), int(by))
        time.sleep(dur / n)


def click(pause=0.06):
    u.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(pause)
    u.mouse_event(0x0004, 0, 0, 0, 0)


def wheel(notches, gap=0.035):
    """notches > 0 向上，< 0 向下。一格 = 120。"""
    step = 120 if notches > 0 else -120
    for _ in range(abs(notches)):
        u.mouse_event(0x0800, 0, 0, step, 0)
        time.sleep(gap)


def glide_wheel(total, chunk=3, gap_between=0.25):
    """分几段滚，段间停一下 —— 人不会一口气滚到底。"""
    done = 0
    while abs(done) < abs(total):
        n = min(chunk, abs(total) - abs(done))
        wheel(n if total > 0 else -n)
        done += n if total > 0 else -n
        if abs(done) < abs(total):
            time.sleep(gap_between + random.uniform(0, 0.08))


# ─────────────────────────── 键盘（2026-10-20 补 · R05 输入路径 / R09 搜扩展） ───────────────────────────
# 为什么不用 clipboard 粘贴：剪贴板是全局状态，录屏时别的程序可能抢；
#   而且粘贴不产生"逐字落下"的画面感，观众看不到你在打字。
# 用 VkKeyScanW 查物理键位 + Shift 状态，比手写 vk 表可靠（不同键盘布局都对）。
VK_SHIFT = 0x10


def type_text(s, gap=0.045):
    """逐字敲一段文本（仅 ASCII / 常见符号；中文走输入法，不在本函数范围）。"""
    for ch in s:
        r = u.VkKeyScanW(ord(ch))
        if r == -1:
            continue
        vk = r & 0xFF
        need_shift = (r >> 8) & 1
        if need_shift:
            u.keybd_event(VK_SHIFT, 0, 0, 0)
        u.keybd_event(vk, 0, 0, 0)
        time.sleep(gap * 0.6)
        u.keybd_event(vk, 0, 2, 0)
        if need_shift:
            u.keybd_event(VK_SHIFT, 0, 2, 0)
        time.sleep(gap)


def press(vk, times=1, gap=0.07):
    """按一个键（vk 用十进制，如 13=Enter / 27=Esc / 9=Tab）。"""
    for _ in range(times):
        u.keybd_event(vk, 0, 0, 0)
        time.sleep(0.02)
        u.keybd_event(vk, 0, 2, 0)
        time.sleep(gap)


def hotkey(vk_mod, vk_key):
    """组合键，如 Ctrl+A = hotkey(0x11, 0x41)。"""
    u.keybd_event(vk_mod, 0, 0, 0)
    time.sleep(0.03)
    u.keybd_event(vk_key, 0, 0, 0)
    time.sleep(0.04)
    u.keybd_event(vk_key, 0, 2, 0)
    time.sleep(0.02)
    u.keybd_event(vk_mod, 0, 2, 0)
    time.sleep(0.06)


def hotkey2(mod1, mod2, vk):
    """三键组合，如 Ctrl+Shift+X = hotkey2(0x11, 0x10, 0x58)。"""
    u.keybd_event(mod1, 0, 0, 0); time.sleep(0.03)
    u.keybd_event(mod2, 0, 0, 0); time.sleep(0.03)
    u.keybd_event(vk, 0, 0, 0); time.sleep(0.05)
    u.keybd_event(vk, 0, 2, 0); time.sleep(0.03)
    u.keybd_event(mod2, 0, 2, 0); time.sleep(0.02)
    u.keybd_event(mod1, 0, 2, 0); time.sleep(0.06)


if __name__ == '__main__':
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'pos'
    if cmd == 'pos':
        print(pos())
    elif cmd == 'demo':
        move(900, 520, .8)
        glide_wheel(-9)
        move(1200, 300, .6)
        glide_wheel(6)
