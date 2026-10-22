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

# ───────────────── 键盘 · SendInput 通道（2026-10-22 加，有实测支撑） ─────────────────
# 为什么另起一套而不用上面的 type_text：
#   实测（_speedtest/kbd_lab.py）VkKeyScanW + keybd_event 这条路有三个硬伤 ——
#   ① 中文 VkKeyScanW 返回 -1，type_text 直接 continue ⇒ **静默丢掉**，不报错；
#   ② 走的是物理键位，输入法在中文态时会把 `-p ` 吃成 `-拍`；
#   ③ 依赖键盘布局，换个布局同一条脚本打出来的东西不同。
#   SendInput 的 KEYEVENTF_UNICODE 通道是"直接告诉系统我要这个字"，
#   不经过键位映射、不经过输入法，中文/符号/反斜杠一次过。
from ctypes import wintypes as _wt

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", _wt.WORD), ("wScan", _wt.WORD), ("dwFlags", _wt.DWORD),
                ("time", _wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", _wt.LONG), ("dy", _wt.LONG), ("mouseData", _wt.DWORD),
                ("dwFlags", _wt.DWORD), ("time", _wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", _wt.DWORD), ("wParamL", _wt.WORD), ("wParamH", _wt.WORD)]


class _INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT), ("hi", _HARDWAREINPUT)]

    _anonymous_ = ("u",)
    _fields_ = [("type", _wt.DWORD), ("u", _U)]


u.SendInput.argtypes = [_wt.UINT, ctypes.POINTER(_INPUT), ctypes.c_int]
u.SendInput.restype = _wt.UINT

_KEYEVENTF_KEYUP = 0x0002
_KEYEVENTF_UNICODE = 0x0004
_INPUT_KEYBOARD = 1


def _send_inputs(ins):
    arr = (_INPUT * len(ins))(*ins)
    return u.SendInput(len(ins), arr, ctypes.sizeof(_INPUT))


def _ki_unicode(ch, up=False):
    x = _INPUT(type=_INPUT_KEYBOARD)
    x.ki = _KEYBDINPUT(0, ord(ch), _KEYEVENTF_UNICODE | (_KEYEVENTF_KEYUP if up else 0), 0, 0)
    return x


def _ki_vk(vk, up=False):
    x = _INPUT(type=_INPUT_KEYBOARD)
    x.ki = _KEYBDINPUT(vk, 0, _KEYEVENTF_KEYUP if up else 0, 0, 0)
    return x


def type_unicode(s, gap=0.0, chunk=200):
    """打字（Unicode 通道）。gap=0 一次投递（最快，~30ms/12 字）；gap>0 逐字带间隔（有打字感）。

    ★ 单次 SendInput 有条数上限（AHK 文档记 ~5000 字符，含按下+抬起各算一条），
      所以按 chunk 分片投递，避免长文本被系统截断。
    """
    if gap <= 0:
        for i in range(0, len(s), chunk):
            ins = []
            for ch in s[i:i + chunk]:
                ins.append(_ki_unicode(ch))
                ins.append(_ki_unicode(ch, True))
            _send_inputs(ins)
        return
    for ch in s:
        _send_inputs([_ki_unicode(ch), _ki_unicode(ch, True)])
        time.sleep(gap)


def type_human(s, gap=0.055, jitter=0.02):
    """像人一样打：字间有小抖动，句读处略停。用于要"看着像打字"的镜头。"""
    for ch in s:
        _send_inputs([_ki_unicode(ch), _ki_unicode(ch, True)])
        d = gap + random.uniform(0, jitter)
        if ch in "，。,.!?、;；":
            d += gap * 2
        time.sleep(d)


def ctrl_key(vk, waits=(0.02, 0.02, 0.02, 0.02)):
    """Ctrl + 某键。★ 修饰键必须单独投递：和主键塞进同一次 SendInput，修饰会丢。"""
    _send_inputs([_ki_vk(0x11)])
    time.sleep(waits[0])
    _send_inputs([_ki_vk(vk)])
    time.sleep(waits[1])
    _send_inputs([_ki_vk(vk, True)])
    time.sleep(waits[2])
    _send_inputs([_ki_vk(0x11, True)])
    time.sleep(waits[3])


def set_clipboard(text):
    """整段写剪贴板。粘贴 = 一次 Ctrl+V，长文本也是 120ms 左右。"""
    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002
    k32 = ctypes.windll.kernel32
    k32.GlobalAlloc.restype = _wt.HGLOBAL
    k32.GlobalAlloc.argtypes = [_wt.UINT, ctypes.c_size_t]
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [_wt.HGLOBAL]
    k32.GlobalUnlock.argtypes = [_wt.HGLOBAL]
    u.SetClipboardData.argtypes = [_wt.UINT, _wt.HANDLE]
    u.SetClipboardData.restype = _wt.HANDLE
    for _ in range(8):
        if u.OpenClipboard(None):
            break
        time.sleep(0.03)
    else:
        raise RuntimeError("剪贴板打不开（被其他程序占用）")
    try:
        u.EmptyClipboard()
        data = text.encode("utf-16-le") + b"\x00\x00"
        h = k32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        p = k32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k32.GlobalUnlock(h)
        u.SetClipboardData(CF_UNICODETEXT, h)
    finally:
        u.CloseClipboard()


def get_clipboard():
    CF_UNICODETEXT = 13
    k32 = ctypes.windll.kernel32
    # ★ 不设 restype，64 位句柄会被截成 int32 ⇒ GlobalLock 返回野指针 ⇒ 读它直接 access violation
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [ctypes.c_void_p]
    k32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    # ★ GetClipboardData 同样要设 restype：默认返回 int32，句柄高位被截掉
    u.GetClipboardData.argtypes = [_wt.UINT]
    u.GetClipboardData.restype = _wt.HANDLE
    for _ in range(8):
        if u.OpenClipboard(None):
            break
        time.sleep(0.03)
    else:
        return ""
    try:
        h = u.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return ""
        p = ctypes.windll.kernel32.GlobalLock(h)
        try:
            return ctypes.wstring_at(p) if p else ""
        finally:
            ctypes.windll.kernel32.GlobalUnlock(h)
    finally:
        u.CloseClipboard()


def paste_text(s, restore=True):
    """整段粘贴。长文本用这个：120ms，不随长度变。restore=True 会还原剪贴板。"""
    old = get_clipboard() if restore else None
    set_clipboard(s)
    time.sleep(0.03)
    ctrl_key(0x56)
    time.sleep(0.05)
    if restore and old is not None:
        try:
            set_clipboard(old)
        except Exception:
            pass


def clear_field(verify=None):
    """清空当前输入框：Ctrl+A → Delete。

    verify: 可选回调，返回 True 表示确实空了（例如读窗口标题）。
    ★ 字段本来就空时不会产生任何事件，"清空成功"是**没法从事件侧证明**的，
      要么回读，要么接受它本来就是空的。
    """
    ctrl_key(0x41)
    _send_inputs([_ki_vk(0x2E), _ki_vk(0x2E, True)])
    time.sleep(0.05)
    if verify is not None:
        return bool(verify())
    return True

