#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""auto_record.py —— 录屏编排器（鼠标自动操作 + 一键录制）

为什么要有它：mouse.py 只给了「人手」（移动/点击/滚动），
但一次能用的录屏还需要另外四件事，散着做每次都会漏一件：
    ① 录之前关通知  ② 开 ffmpeg  ③ 动作按脚本来   ④ 录完恢复通知（异常也要恢复）

用法：
    python auto_record.py --script s.json --out out.mp4 [--dur 12] [--fps 30]
    python auto_record.py --script s.json --out out.mp4 --dry     # 只算时长不录

脚本格式（steps 按顺序执行）：
    {"name":"r01",
     "steps":[
       {"do":"wait","s":1.0},
       {"do":"move","x":900,"y":420,"dur":0.9,"curve":0.12},
       {"do":"click"},
       {"do":"wheel","n":5},
       {"do":"wait","s":0.6}
     ]}

设计约束（都是踩过的）：
  · 通知开关必须**成对**，且写在 finally 里 —— 中途异常也要还原（需求方原话「我正常用电脑还是要听通知的」）。
  · ffmpeg 用 gdigrab 直接抓桌面；`-t` 卡死时长，**不用 -shortest**（总规格锁禁用）。
  · 录完必须 ffprobe 校验：文件在、有时长、有画面 —— 退出码 0 不算证据。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mouse as M  # noqa: E402

FF_CANDIDATES = [
    # 装了 winget 版 ffmpeg 的机器可以设 FFMPEG_BIN 指过去；否则靠 PATH
    os.environ.get("FFMPEG_BIN", ""),
    shutil.which("ffmpeg") or "",
]
PS1 = HERE / "record_mode.ps1"


def ffmpeg_path():
    for p in FF_CANDIDATES:
        if p and Path(p).exists():
            return p
    raise SystemExit("找不到 ffmpeg：请把路径加到 FF_CANDIDATES")


def ffprobe_path():
    f = Path(ffmpeg_path())
    cand = f.with_name("ffprobe.exe")
    return str(cand if cand.exists() else "ffprobe")


def toasts(action):
    """on = 关通知（录制中）；off = 恢复。名字按 record_mode.ps1 的原义，别反着理解。"""
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(PS1), "-Action", action],
        capture_output=True, text=True, check=False,
    )


LAST_RECT = {}


def _force_foreground(h):
    """把窗口真正提到前台。返回 True/False。

    ★ SetForegroundWindow 在"前台锁定"下会**静默失败**：返回值不说明问题，
      只有事后查 GetForegroundWindow 才知道有没有成功。解法是临时把自己
      接到当前前台线程的输入队列上（AttachThreadInput），再抢。
    """
    import ctypes
    u = ctypes.windll.user32
    u.ShowWindow(h, 9)                      # SW_RESTORE：最小化的先还原
    if u.GetForegroundWindow() == h:
        return True
    fg = u.GetForegroundWindow()
    tid_fg = u.GetWindowThreadProcessId(fg, None) if fg else 0
    tid_me = ctypes.windll.kernel32.GetCurrentThreadId()
    if tid_fg and tid_fg != tid_me:
        u.AttachThreadInput(tid_me, tid_fg, True)
        u.SetForegroundWindow(h)
        u.BringWindowToTop(h)
        u.AttachThreadInput(tid_me, tid_fg, False)
    else:
        u.SetForegroundWindow(h)
    if u.GetForegroundWindow() == h:
        return True
    try:                                     # 兜底：切任务窗口（不受前台锁定约束）
        u.SwitchToThisWindow(h, True)
    except Exception:
        pass
    return u.GetForegroundWindow() == h


def focus(title, size=None, pos=None):
    """把标题含 title 的窗口提到前台。

    size/pos 给了就**钉住窗口矩形**（录固定区域时必需）——
    否则 SW_MAXIMIZE 会把窗口撑到整块桌面，录 1920×1080 就只拿到左上四分之一（实测踩过）。
    """
    import ctypes
    from ctypes import wintypes
    u = ctypes.windll.user32
    hits = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def cb(h, _):
        n = u.GetWindowTextLengthW(h)
        if n:
            b = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, b, n + 1)
            if title.lower() in b.value.lower():
                hits.append(h)
        return True

    u.EnumWindows(CB(cb), 0)
    if not hits:
        return False
    h = hits[0]
    if size:
        w, hh = [int(v) for v in str(size).split("x")]
        px, py = [int(v) for v in (pos or "0,0").split(",")]
        # SWP_NOZORDER(0x4) | SWP_SHOWWINDOW(0x40)：只挪位置改尺寸，不改层级
        u.SetWindowPos(h, 0, px, py, w, hh, 0x0004 | 0x0040)
        time.sleep(0.35)
    else:
        u.ShowWindow(h, 3)  # SW_MAXIMIZE
    # SetForegroundWindow 会被「前台锁定」挡掉且不报错 ⇒ 先置顶再抢焦点，
    # 抢不到就 AttachThreadInput 借前台线程的输入队列（2026-10-22 实测：直接调会被挡）
    u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002)
    _force_foreground(h)
    time.sleep(0.6)
    fg = u.GetForegroundWindow()
    try:
        r = ctypes.wintypes.RECT()
        u.GetWindowRect(h, ctypes.byref(r))
        LAST_RECT.update(x=r.left, y=r.top, w=r.right - r.left, h=r.bottom - r.top)
    except Exception:
        pass
    return fg == h


def warm_click(rect=None):
    """吃掉「第一次点击只用于激活窗口」那一口 —— 必须发生在 ffmpeg 开录之前，否则会录进画面。

    实测：focus() 报 ok（GetForegroundWindow 已经是它），但紧接着的第一下鼠标点击
    仍会被系统当成「激活」吞掉，页面收不到 click —— 又是一次零报错的失败。
    """
    import mouse as M
    r = rect or LAST_RECT
    if not r:
        return False
    M.move(int(r["x"] + r["w"] / 2), int(r["y"] + 14), 0.01, 0)   # 标题栏正中
    time.sleep(0.12)
    M.click()
    time.sleep(0.25)
    return True


def set_clipboard(text):
    """用 Win32 直接把文本写进剪贴板（不走外部进程、不走 PowerShell）。

    为什么必须有这一步：本机有常驻程序会**随时改写剪贴板**（实测粘出来的是
    电商商品名「某个电商商品名」而不是我们要的 esp-idf，RC-002）。
    所以剪贴板不能在开录前预设一次了事 —— 必须在 **Ctrl+V 前 0.1 秒**再写一次。
    """
    import ctypes
    from ctypes import wintypes
    u, k32 = ctypes.windll.user32, ctypes.windll.kernel32
    # ★ 64 位必须显式声明 restype：ctypes 默认按 c_int 收句柄，会把 HGLOBAL 截成 0
    #   ⇒ GlobalLock 返回 NULL ⇒ memmove 写地址 0 ⇒ access violation（实测踩过）
    k32.GlobalAlloc.restype = wintypes.HGLOBAL
    k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    k32.GlobalLock.restype = wintypes.LPVOID
    k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    u.SetClipboardData.restype = wintypes.HANDLE
    u.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    for _ in range(6):                       # 剪贴板被别的进程占着是常态，重试
        if u.OpenClipboard(None):
            break
        time.sleep(0.05)
    else:
        raise RuntimeError("剪贴板打不开（被其他程序占用）")
    try:
        u.EmptyClipboard()
        data = text.encode("utf-16-le") + b"\x00\x00"
        GMEM_MOVEABLE = 0x0002
        h = k32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        p = k32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k32.GlobalUnlock(h)
        CF_UNICODETEXT = 13
        if not u.SetClipboardData(CF_UNICODETEXT, h):
            raise RuntimeError("SetClipboardData 失败")
    finally:
        u.CloseClipboard()


def est_dur(steps):
    t = 0.0
    for s in steps:
        k = s.get("do")
        if k == "move":
            t += float(s.get("dur", 0.7))
        elif k == "click":
            t += float(s.get("pause", 0.06)) + 0.12
        elif k == "wheel":
            t += abs(int(s.get("n", 1))) * 0.035
        elif k == "wait":
            t += float(s.get("s", 0.5))
        elif k == "focus":
            t += 0.5
        elif k in ("type", "typehuman"):
            t += len(str(s.get("text", ""))) * float(s.get("gap", 0.06))
        elif k in ("typefast", "paste"):
            t += 0.15
        elif k == "press":
            t += int(s.get("times", 1)) * 0.1
        elif k == "hotkey":
            t += 0.2
        elif k == "hotkey2":
            t += 0.25
        elif k == "clip":
            t += 0.05
    return t


def run_steps(steps):
    for s in steps:
        k = s.get("do")
        if k == "move":
            M.move(int(s["x"]), int(s["y"]), float(s.get("dur", 0.7)), float(s.get("curve", 0.12)))
        elif k == "click":
            M.click(float(s.get("pause", 0.06)))
        elif k == "wheel":
            M.wheel(int(s.get("n", 1)))
        elif k == "wait":
            time.sleep(float(s.get("s", 0.5)))
        elif k == "type":
            # ★ 走 Unicode 通道：VkKeyScanW 那套中文静默丢、输入法会把 "-p " 吃成 "-拍"
            M.type_unicode(str(s.get("text", "")), float(s.get("gap", 0.0)))
        elif k == "typefast":
            M.type_unicode(str(s.get("text", "")), 0.0)
        elif k == "typehuman":
            M.type_human(str(s.get("text", "")), float(s.get("gap", 0.055)))
        elif k == "paste":
            M.paste_text(str(s.get("text", "")))
        elif k == "press":
            M.press(int(s.get("vk", 13)), int(s.get("times", 1)))
        elif k == "hotkey":
            M.hotkey(int(s.get("mod", 0x11)), int(s.get("vk", 0x41)))
        elif k == "hotkey2":
            M.hotkey2(int(s.get("mod", 0x11)), int(s.get("mod2", 0x10)), int(s.get("vk", 0x58)))
        elif k == "clip":
            set_clipboard(str(s.get("text", "")))
            print("[clip] " + str(s.get("text", "")))
        elif k == "focus":
            ok = focus(s.get("title", ""), s.get("size"), s.get("pos"))
            print(("[focus] " + s.get("title", "") + (" ok" if ok else " FAILED（窗口在但抢不到前台，或标题不存在）")))
            if not ok:
                raise RuntimeError("focus 失败：" + s.get("title", ""))
        else:
            print(f"[warn] 未知动作 {k}，跳过")


def record(script, out, dur=None, fps=30, dry=False, region=None):
    steps = script.get("steps", [])
    body = est_dur(steps)
    total = float(dur) if dur else body + 1.4

    print(f"[plan] 动作 {len(steps)} 步 · 估计 {body:.2f}s · 录制 {total:.2f}s · {fps}fps")
    if dry:
        for i, s in enumerate(steps, 1):
            print(f"  {i:02d} {s}")
        return 0

    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    ff = ffmpeg_path()
    cmd = [ff, "-y", "-hide_banner", "-loglevel", "error", "-f", "gdigrab", "-framerate", str(fps)]
    if region:  # x,y,w,h —— 3440 宽的带鱼屏上只截浏览器那一块，产物仍是 1920×1080
        rx, ry, rw, rh = [int(v) for v in str(region).split(",")]
        cmd += ["-offset_x", str(rx), "-offset_y", str(ry), "-video_size", f"{rw}x{rh}"]
    cmd += [
        "-i", "desktop",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-t", f"{total:.2f}", str(out),
    ]

    # —— 预热：先把窗口激活 + 吃掉第一次点击，再开录（这一段不进画面） ——
    pres = [x for x in steps if x.get("do") == "focus"]
    for x in pres:
        try:
            focus(x.get("title", ""), x.get("size"), x.get("pos"))
            warm_click()
        except Exception as e:
            print("[warn] 预热失败", e)

    toasts("on")  # 关通知
    proc = None
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(1.0)  # 让编码器吃上第一帧，否则开头是黑
        run_steps(steps)
        left = total - (1.0 + body)
        if left > 0:
            time.sleep(left)
        try:
            proc.communicate(input=b"q", timeout=30)
        except Exception:
            proc.terminate()
            proc.wait(timeout=15)
    finally:
        toasts("off")  # ★ 无论成败都恢复
        if proc and proc.poll() is None:
            proc.kill()

    # ── 校验：退出码不算证据，必须看产物 ──
    if not out.exists() or out.stat().st_size < 1024:
        print(f"[FAIL] 产物不存在或过小：{out}")
        return 2
    pr = subprocess.run(
        [ffprobe_path(), "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,nb_frames:format=duration",
         "-of", "default=nw=1:nk=1", str(out)],
        capture_output=True, text=True,
    )
    nums = [x for x in pr.stdout.strip().splitlines() if x.strip()]
    print(f"[ok] {out.name} · {out.stat().st_size/1024:.0f} KB · " + " / ".join(nums))
    if len(nums) < 4:
        print("[FAIL] ffprobe 读数不完整（可能没有画面）")
        return 3
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dur", type=float, default=None)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--region", default=None, help="x,y,w,h 只录这一块")
    a = ap.parse_args()
    script = json.loads(Path(a.script).read_text(encoding="utf-8"))
    sys.exit(record(script, a.out, a.dur, a.fps, a.dry, a.region))


if __name__ == "__main__":
    main()
