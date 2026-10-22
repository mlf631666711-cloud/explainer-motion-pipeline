#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rec_web.py —— 一条命令录一段「网页操作」镜头（R01 / R02 / R09 / R10 这类都能用）

   python rec_web.py --url <页面> --steps <选择器清单.json> --out <x.mp4> [--dur 秒]

它把四件事按顺序串起来（每一步都是踩过坑才补上的）：
  ① node web_drive.cjs 开真 Chrome、钉住窗口 1920×1080@(0,0)、插红标、DOM 取矩形
  ② calib.py 抓一帧找红标 ⇒ 视口原点（像素校准，不信 outerHeight-innerHeight）
  ③ 卸红标 → 生成动作脚本 → auto_record.py 录固定区域（预热点击已内置）
  ④ 收 Chrome（只杀自己开的那只，按 pid）

steps 文件格式：
   {"prep":[{"sel":"button.tab-button","idx":1}],      # 测量前先用 CDP 点一下（让 v-if 的元素进 DOM）
    "steps":[{"sel":"button.tab-button","idx":1,"label":"Offline 标签","wait":1.4}, ...]}
   wait = 点完这一下之后给观众看多久（默认 1.4s）
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import calib as C  # noqa: E402

NODE = os.environ.get("NODE_BIN") or "node"
NODE_PATH = os.environ.get("NODE_PATH", "node_modules")
CHROME_TITLE = "ESP-IDF Installation Manager"


def build_script(rects_json, origin, title, hold=1.4):
    """把「元素矩形」翻译成「屏幕动作」。

    支持三类步骤（2026-10-20 补后两类）：
      ① DOM 元素：{"sel":"#x","idx":0,"hover":true,"wait":1.4}
      ② 屏幕绝对坐标（浏览器自己的 UI，比如下载气泡，DOM 里量不到）：
         {"sel":"@screen","x":1700,"y":120,"click":false,"wait":1.6}
      ③ 点完要打字：{"sel":"input","idx":0,"typ":"E:\\esp\\v6.1","enter":true}
    """
    J = json.loads(Path(rects_json).read_text(encoding="utf-8"))
    ox, oy = origin
    steps = [{"do": "focus", "title": title, "size": "1920x1080", "pos": "0,0"},
             {"do": "wait", "s": 1.2}]
    n = 0
    dur = 1.2
    for s in J["steps"]:
        # ② 绝对屏幕坐标：不参与校准偏移，直接给屏幕像素
        if str(s.get("sel", "")).startswith("@screen"):
            if not s.get("x"):
                continue
            steps += [{"do": "move", "x": int(s["x"]), "y": int(s["y"]),
                       "dur": float(s.get("dur", 0.9)), "curve": 0.06},
                      {"do": "wait", "s": 0.25}]
            dur += float(s.get("dur", 0.9)) + 0.25
            if s.get("click"):
                steps.append({"do": "click"})
                dur += 0.2
            w = float(s.get("wait", hold))
            steps.append({"do": "wait", "s": w})
            dur += w
            n += 1
            continue

        if not (s.get("found") and s.get("visible")):
            print(f"  [skip] {s.get('label') or s.get('sel')} 未找到/不可见")
            continue
        steps += [{"do": "move", "x": ox + s["cx"], "y": oy + s["cy"], "dur": 1.0, "curve": 0.1},
                  {"do": "wait", "s": 0.28}]
        dur += 1.28
        if not s.get("hover"):          # hover=true 就是「把手指过去但不点」，用于下拉/按钮预览
            steps.append({"do": "click"})
            dur += 0.2
        if s.get("typ"):
            steps.append({"do": "type", "text": str(s["typ"])})
            dur += len(str(s["typ"])) * 0.045
        if s.get("enter"):
            steps.append({"do": "press", "vk": 13})
            dur += 0.3
        w = float(s.get("wait", hold))
        steps.append({"do": "wait", "s": w})
        dur += w
        n += 1
    if n == 0:
        raise SystemExit("一个目标元素都没找到 —— 页面没起来或选择器过期，不录空画面")
    steps.append({"do": "wait", "s": 1.6})
    dur += 1.6
    return {"name": "web", "steps": steps}, round(dur, 2)


def kill_stale_chrome():
    """清掉上一次没退干净的自动化 Chrome。

    ★ 为什么必须有：录成功的那一次，rec_web 用 `_chrome.pid` 清理，
      但 puppeteer 的 pid 写的是 launcher 进程，真浏览器是它的子进程；
      残留一只就够让下一次 launch 拿不到调试端口 —— 表现是 _drive.log 完全空白，
      而 rec_web 只会说「60s 没就绪」。**只杀带 remote-debugging 的根进程，不动用户自己的浏览器。**
    """
    ps = (
        "$a=Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\";"
        "$p=$a.ProcessId;"
        "$a|Where-Object{$p -notcontains $_.ParentProcessId -and $_.CommandLine -match 'remote-debugging'}"
        "|ForEach-Object{taskkill /F /T /PID $_.ProcessId|Out-Null}"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--steps", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dur", type=float, default=None)
    ap.add_argument("--region", default="0,0,1920,1080")
    ap.add_argument("--title", default=CHROME_TITLE)
    a = ap.parse_args()

    kill_stale_chrome()

    rects = HERE / "_rects.json"
    ready = HERE / "_ready.txt"
    sig = HERE / "_calib_sig"
    pidf = HERE / "_chrome.pid"
    for f in (rects, ready, sig, Path(str(sig) + ".done"), pidf):
        f.unlink(missing_ok=True)

    env = dict(os.environ, NODE_PATH=NODE_PATH)
    drv = subprocess.Popen([NODE, str(HERE / "web_drive.cjs"), a.url, str(rects), str(ready),
                            a.steps, str(pidf), str(sig)],
                           cwd=str(HERE), env=env,
                           stdout=open(HERE / "_drive.log", "w", encoding="utf-8"), stderr=subprocess.STDOUT)
    try:
        t0 = time.time()
        while not ready.exists():
            if time.time() - t0 > 60:
                raise SystemExit("浏览器 60s 没就绪，看 _drive.log")
            time.sleep(0.5)
        print((HERE / "_drive.log").read_text(encoding="utf-8").strip())

        buf, w, h = C.grab_raw(str(HERE / "_calib.raw"))
        hit = C.find_red(buf, w, h)
        if not hit:
            raise SystemExit("找不到红标 —— 页面没起来或被别的窗口挡住")
        print(f"[calib] 视口原点 = 屏幕 {hit}")

        sig.write_text("go")
        t1 = time.time()
        while not Path(str(sig) + ".done").exists() and time.time() - t1 < 20:
            time.sleep(0.2)

        script, dur = build_script(rects, hit, a.title)
        sp = HERE / "_auto_rec.json"
        sp.write_text(json.dumps(script, ensure_ascii=False, indent=1), encoding="utf-8")
        dur = a.dur or dur
        print(f"[rec] {len(script['steps'])} 步 · {dur}s")
        rc = subprocess.call([sys.executable, str(HERE / "auto_record.py"), "--script", str(sp),
                              "--out", a.out, "--region", a.region, "--dur", str(dur)])
        return rc
    finally:
        try:
            pid = int(pidf.read_text().strip())
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
        except Exception:
            pass
        drv.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
