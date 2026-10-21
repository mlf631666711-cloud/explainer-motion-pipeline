# Explainer Motion Pipeline

[中文](README.md) · **English**

![cover](preview.png)

Turn a narration script into **deliverable motion segments**: one HTML page per shot, rendered frame-by-frame into 4K video with the voice track.

Two disciplines hold it together — **falsifiable** (every shot must pass two machine gates) and **not-AI-looking** (subtract, don't add).

> Live preview: <https://mlf631666711-cloud.github.io/explainer-motion-pipeline/>

---

## The problem it actually solves

When AI makes explainer animation, the usual failure isn't "ugly" — it's **obviously machine-made**:

| Symptom | What you think | What it really is |
|---|---|---|
| Everything fades in | "needs richer motion" | no **direction**; a fade is motion that isn't motion |
| Elements settle, then freeze | "pacing is slow" | no **second beat** — the audience waits for you |
| Screen packed with cards and icons | "not enough info" | no **editing**; one screen gets one protagonist |
| A 24px caption in the corner | "clarifying note" | you're **inventing copy** the narration never said — peak AI smell |
| Rounded corners + gradient + glow | "modern" | it's the **default** in the training data |

This repo ships **gates, a template, and rulers** — not taste. Whether it looks good is still your call; whether it is *empty, frozen, out-of-bounds, or machine-assembled* is decidable by machine.

## Three sources, one sentence

> **AI smell = default values + averaging + over-explaining.**
> Defaults: reaching for the most common visual (rounded / gradient / glow / centered).
> Averaging: equal spacing, equal duration, equal weight — humans design with **contrast**, models pick the **median**.
> Over-explaining: afraid of missing info, so you finish the audience's sentences for them.
> ⇒ **Removing AI smell = deleting half of it on purpose.**

Full version: [`references/anti-ai-taste.md`](references/anti-ai-taste.md).

## Layout

```
.
├── SKILL.md                      # main skill file (workflow / contracts / checklist / anti-patterns)
├── references/
│   ├── anti-ai-taste.md          # ★ the core: sources, four layers, 60-second self-check
│   ├── motion-vocabulary.md      # 12 motion patterns, each with copy-pasteable code
│   ├── layout-system.md          # safe area / type scale / color / hard-edge cards / product images
│   ├── qa-gates.md               # gate thresholds + four ways a gate lies to you
│   └── recording-enhance.md      # packaging screen recordings into explainer segments
├── scripts/
│   ├── density_check.cjs         # gate ①: is the frame alive?
│   ├── safe_check.cjs            # gate ②: is content inside the box and wide enough?
│   ├── render.cjs                # HTML → video (frame-accurate, 4K by default)
│   ├── render-record.cjs         # record-enhancement pages → video (per-frame <video> seek)
│   └── probe.cjs                 # sample a few frames for human review
├── assets/
│   └── shot-template.html        # ★ starter template (passes both gates out of the box)
├── recording/                    # ★ automated screen recording: real browser, real cursor (Windows)
│   ├── rec_web.py                # one command: launch → measure → record → click
│   ├── web_drive.cjs             # headful Chrome + DOM rects + a red calibration marker
│   ├── calib.py                  # find the marker in a frame = viewport origin
│   ├── auto_record.py            # region capture + real mouse + warm-up/sentinel
│   └── mouse.py  record_mode.ps1
├── index.html
└── preview.png
```

## Quick start

```bash
# 0) deps: node + Chrome + ffmpeg + puppeteer-core
npm i puppeteer-core            # or point NODE_PATH at any node_modules that has it

# 1) copy the template and make it yours
cp assets/shot-template.html my-shot.html

# 2) run the gates (no render until it passes)
node scripts/density_check.cjs "my-shot.html"
node scripts/safe_check.cjs    "my-shot.html" --step 0.5

# 3) sample frames and look at them
node scripts/probe.cjs "my-shot.html" "2,4,5.4" _p

# 4) render 4K (pass - if there's no voice track)
node scripts/render.cjs "my-shot.html" 6.0 voice.mp3 "out/my-shot-4K.mp4"
```

`DEVICE_SCALE=2` (default) ⇒ a 1920×1080 page renders at 3840×2160.

## Three hard contracts

| Contract | Value | Why |
|---|---|---|
| `#stage` | 1920×1080 | everything is absolutely positioned inside it; the viewport matches |
| `window.DUR` | shot length in seconds | the gates sample over it; must equal the voice clip (±0.02s) |
| `render(t)` | **pure function** | depends only on `t` ⇒ seekable, re-renderable, byte-identical across runs |

## Two rulers

**Gate ① `density_check`** — catches "empty" and "frozen"

| Reading | Threshold |
|---|---|
| visible objects | ≥ 12 |
| content events / sec | ≥ 3 |
| longest content silence | ≤ 1.2s |

> Meters (grid, progress lines) must be tagged `class="meter"`: they report readings but **never count as content events** — otherwise one full-length progress bar "fills" the silence and a blank screen passes.

**Gate ② `safe_check`** — catches "out of bounds" and "shrunk"

| Check | Threshold |
|---|---|
| vertical | content within `y ∈ [154, 926]` (top 154 = progress bar, bottom 154 = subtitles) |
| horizontal | content bounding box ≥ 1600px (83% of 1920) |

> 1600, not 1920: layouts need ~150px of editorial margin. But "scale the whole frame down and center it" collapses to 1372 (71%) — that has to be caught. It really happened; a whole batch got re-laid-out.

**If a gate says PASS and your eyes disagree — suspect the gate first.** Both scripts have shipped bugs where they validated themselves. See [`references/qa-gates.md`](references/qa-gates.md).

## Automated screen recording (Windows)

Explainer videos often need "a human actually operating the software" shots. Headless rendering has no cursor, and a drawn-on software cursor always betrays itself. `recording/` does the opposite: **structure from the DOM, gestures from the OS, truth from pixels.**

```bash
set NODE_PATH=C:\path\to\node_modules        # needs puppeteer-core
python recording/rec_web.py --url "https://example.com/setup" --steps my_steps.json --out out/r01.mp4
```

One command: launch a headful Chrome → read element rects → **inject a 12×12 red marker** → grab a frame and locate the marker (that's the viewport origin) → `gdigrab` the region → drive a real mouse.

All five pitfalls live in [`recording/README.md`](recording/README.md) — they share one property: **none of them raise an error.**
Window maximized past the capture region · the first click swallowed by window activation · viewport origin guessed from `outerHeight−innerHeight` (off by 8–39px) · `reload()` restoring a URL-hash tab · `goto()` resolving on an error page.

> Recording is only raw material. Turning it into an explainer segment (fixed frame + in-frame push-in + side rail + A/V alignment) is documented in [`references/recording-enhance.md`](references/recording-enhance.md).

## Twelve motion patterns (excerpt)

| # | Pattern | One-line rule |
|---|---|---|
| 1 | Mask slide-in | `overflow:hidden` + `translateY(104%)` — ten times better than a fade |
| 2 | Staggered landing | 0.12–0.20s inside a group; **break between groups by meaning** (not `i*0.5`) |
| 3 | Landing rebound | `ob()` easing + `scale 0.94→1` |
| 4 | **Light-up** | border + glow + saturation + scale **all four at once**; recoloring alone is not lighting |
| 5 | Rule sweep | `eio` over 0.7–1.0s |
| 6 | Path draw | `strokeDashoffset` from total length to 0 |
| 7 | Counter / dot fill | number and graphics must arrive **together** |
| 8 | In-frame push-in | frame stays put, only inner `transform` moves — **clamp the center or you'll expose the edge** |
| 9 | Panel slide | viewport **slightly narrower** than page width, or the next page leaks a sliver |
| 10 | Migration line | the node turns red *because* the line reached it — **causality** |
| 11 | Bracket gather | bracket a row to say "same family" |
| 12 | Closing hold | decelerate to zero, then hold ≥0.5s |

## Anti-AI-smell: ten rules

1. **Never invent summary captions.** On-screen text is only: words from the narration / structural labels / diegetic UI. To summarize, use a ≥54px heading or a full color block.
2. **Never only fade.** Move, light up, sweep, or push — `opacity` alone is for exits.
3. **Never one 300ms ease-in-out for everything.** Snap 0.22–0.3s, land 0.45–0.6s, push 0.8–1.4s; no two equal in a beat.
4. **Never equal intervals.** `i*0.5s` is a metronome. Group by meaning.
5. **Allow stillness — but never 1.2s of it.** A hold is a beat; a dead frame is an incident.
6. **Drop the default look.** No rounded+gradient+glow. Paper background, hard edges, hard shadows, one accent color.
7. **Refuse perfect symmetry.** One protagonist per screen; asymmetry and bleed are allowed.
8. **Icons only where they aid recognition.** A row of icons next to a row of text is the most obvious AI layout.
9. **Motion needs cause.** The node turns red because the line reached it; a card lands and something reacts.
10. **No default summary page.** If the narration doesn't summarize, the screen must not either.

## Install as a WorkBuddy / Claude skill

Drop the repo into your skills directory — the `SKILL.md` frontmatter is picked up automatically:

```bash
git clone https://github.com/mlf631666711-cloud/explainer-motion-pipeline \
  ~/.workbuddy/skills/explainer-motion-pipeline
```

## Scope

✅ Explainer / science / tutorial motion segments; concept visualization (comparison, flow, lineage, causality, timeline); packaging screen recordings into explainer segments; **automated capture of real browser sessions (Windows)**.
❌ Live action; shots that need 3D modeling; pure editorial montage.

## License

MIT — see [LICENSE](LICENSE). Every graphic here is generated by code; `assets/shot-template.html` is free to reuse commercially.

---

*Why this exists: across several delivery rounds the machine gates were all green while a human could still tell, at a glance, that it was assembled by a model. The false greens always came from two places — a ruler that measured "too much" but never "too little", and averaging masquerading as design.*
