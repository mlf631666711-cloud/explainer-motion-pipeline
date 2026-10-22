/* anno-kit.js —— 标注件库的驱动（配合 anno-kit.css）
 *
 * 用法（放进美化页）：
 *   <link rel="stylesheet" href="anno-kit.css">
 *   <script src="anno-kit.js"></script>
 *   <script>
 *     ANNO.init({ layer: '#cam', K: 0.71146 });
 *     ANNO.box  ({t0:5.15, t1:8.95, vx:1115, vy:40,  vw:435, vh:92, label:'① 右上角切语言'});
 *     ANNO.pen  ({t0:10.1, t1:10.9, vx:46,   vy:92,  vw:252, vh:12});
 *     ANNO.under({t0:12.0, t1:13.2, vx:520,  vy:700, vw:300});
 *     ANNO.arrow({t0:14.0, t1:16.0, vx:1900, vy:120, toVx:1450, toVy:180});
 *     ANNO.glass({t0:3.0,  t1:6.0,  vx:500,  vy:300, vw:420, vh:120, label:'② 这里'});
 *   </script>
 *   然后在 render(t) 里调 ANNO.tick(t)。
 *
 * 设计约束（与片子一致）：
 *   · 全部由 tick(t) 纯函数驱动，**禁 CSS animation/transition**；
 *   · 坐标用**视频坐标**，kit 自己乘 K —— 作者只需要给 box_finder 吐出来的那组数；
 *   · 一屏强调 ≤2 处（红框/荧光笔各 1），箭头与毛玻璃属于"辅助"，不算强调位。
 */
(function (global) {
  var K = 0.71146, LAYER = '#cam', items = [], layer = null;
  function cl(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function eio(x) { x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function seg(t, a, b) { return (t - a) / (b - a); }
  var SIG = '#C8342A';

  function mk(cls) {
    var d = document.createElement('div');
    d.className = 'ak ' + cls;
    d.setAttribute('data-anno', cls.replace('ak-', ''));
    layer.appendChild(d);
    return d;
  }

  var ANNO = {
    init: function (o) {
      o = o || {};
      K = o.K != null ? o.K : K;
      LAYER = o.layer || LAYER;
      layer = document.querySelector(LAYER);
      if (!layer) throw new Error('anno-kit: 找不到图层 ' + LAYER);
      SIG = o.sig || SIG;
      return ANNO;
    },

    /** ① 红框 —— 点明"这一步点这里" */
    box: function (o) {
      var el = mk('ak-box');
      var it = { kind: 'box', el: el, o: o };
      el.style.left = (o.vx * K) + 'px';
      el.style.top = (o.vy * K) + 'px';
      el.style.width = (o.vw * K) + 'px';
      el.style.height = (o.vh * K) + 'px';
      it.draw = function (t) {
        var p = cl(seg(t, o.t0, o.t0 + 0.32));
        el.style.opacity = (0.95 * (p * p * (3 - 2 * p))).toFixed(3);
        el.style.transform = 'scale(' + (1.12 - 0.12 * (p * p * (3 - 2 * p))).toFixed(3) + ')';
        return t >= o.t0 && t <= o.t1;
      };
      items.push(it); return it;
    },

    /** ② 荧光笔 —— 横刷一道（宽度就是 vw） */
    pen: function (o) {
      var el = mk('ak-pen');
      var it = { kind: 'pen', el: el, o: o };
      el.style.left = (o.vx * K) + 'px';
      el.style.top = (o.vy * K) + 'px';
      el.style.height = (o.vh * K) + 'px';
      el.style.transform = 'rotate(-0.6deg)';
      it.draw = function (t) {
        var p = cl(seg(t, o.t0, o.t1));
        var on = t >= o.t0 && t <= o.t1 + 0.25;
        el.style.opacity = on ? 1 : 0;
        el.style.width = (o.vw * K * eio(p)) + 'px';
        return on;
      };
      items.push(it); return it;
    },

    /** ③ 下划线 —— 从左侧长出来，适合"逐字念到" */
    under: function (o) {
      var el = mk('ak-under');
      var it = { kind: 'under', el: el, o: o };
      el.style.left = (o.vx * K) + 'px';
      el.style.top = (o.vy * K) + 'px';
      it.draw = function (t) {
        var p = cl(seg(t, o.t0, o.t1));
        var on = t >= o.t0 && t <= o.t1 + 0.25;
        el.style.opacity = on ? 1 : 0;
        el.style.width = (o.vw * K * eio(p)) + 'px';
        return on;
      };
      items.push(it); return it;
    },

    /** ④ 箭头 —— 从 (vx,vy) 指到 (toVx,toVy)；线先长，箭头后出现 */
    arrow: function (o) {
      var el = mk('ak-arrow');
      var it = { kind: 'arrow', el: el, o: o };
      var x1 = o.vx * K, y1 = o.vy * K, x2 = o.toVx * K, y2 = o.toVy * K;
      var pad = 14, bx = Math.min(x1, x2) - pad, by = Math.min(y1, y2) - pad;
      var w = Math.abs(x2 - x1) + pad * 2, h = Math.abs(y2 - y1) + pad * 2;
      el.style.left = bx + 'px'; el.style.top = by + 'px';
      el.style.width = w + 'px'; el.style.height = h + 'px';
      el.innerHTML =
        '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<path d="M ' + (x1 - bx) + ' ' + (y1 - by) + ' L ' + (x2 - bx) + ' ' + (y2 - by) + '"/>' +
        '<polygon points="0,0 0,0 0,0"/>' + '</svg>';
      var path = el.querySelector('path'), poly = el.querySelector('polygon');
      var len = Math.hypot(x2 - x1, y2 - y1);
      path.style.strokeDasharray = len + ' ' + len;
      it.draw = function (t) {
        var p = cl(seg(t, o.t0, o.t0 + 0.55));
        var on = t >= o.t0 && t <= o.t1;
        el.style.opacity = on ? 1 : 0;
        path.style.strokeDashoffset = (len * (1 - eio(p))).toFixed(1);
        // 箭头：最后 15% 才出现
        var a = cl(seg(t, o.t0 + 0.55, o.t0 + 0.75));
        var ang = Math.atan2(y2 - y1, x2 - x1), L = 16, W = 7.5;
        var tip = [x2 - bx, y2 - by];
        var b1 = [tip[0] - L * Math.cos(ang) + W * Math.sin(ang), tip[1] - L * Math.sin(ang) - W * Math.cos(ang)];
        var b2 = [tip[0] - L * Math.cos(ang) - W * Math.sin(ang), tip[1] - L * Math.sin(ang) + W * Math.cos(ang)];
        var s = Math.max(0.001, a);
        var mid = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
        var pp = [mid[0] + (b1[0] - mid[0]) * s, mid[1] + (b1[1] - mid[1]) * s];
        var qq = [mid[0] + (b2[0] - mid[0]) * s, mid[1] + (b2[1] - mid[1]) * s];
        var tt = [tip[0] + (mid[0] - tip[0]) * (1 - s), tip[1] + (mid[1] - tip[1]) * (1 - s)];
        poly.setAttribute('points', pp.join(',') + ' ' + qq.join(',') + ' ' + tt.join(','));
        return on;
      };
      items.push(it); return it;
    },

    /** ⑤ 毛玻璃框 —— 压住花底让字读得清；可带一个红标签 */
    glass: function (o) {
      var el = mk('ak-glass');
      var it = { kind: 'glass', el: el, o: o };
      el.style.left = (o.vx * K) + 'px';
      el.style.top = (o.vy * K) + 'px';
      el.style.width = (o.vw * K) + 'px';
      el.style.height = (o.vh * K) + 'px';
      if (o.label) {
        var tag = document.createElement('div');
        tag.className = 'ak-tag';
        tag.textContent = o.label;
        el.appendChild(tag);
        it.tag = tag;
      }
      it.draw = function (t) {
        var p = cl(seg(t, o.t0, o.t0 + 0.4));
        var on = t >= o.t0 && t <= o.t1;
        el.style.opacity = on ? (0.95 * (p * p * (3 - 2 * p))).toFixed(3) : 0;
        if (it.tag) it.tag.style.opacity = on ? cl(seg(t, o.t0 + 0.25, o.t0 + 0.5)).toFixed(2) : 0;
        return on;
      };
      items.push(it); return it;
    },

    /** 逐帧驱动：render(t) 里调这一句 */
    tick: function (t) {
      var any = false;
      for (var i = 0; i < items.length; i++) {
        // ★ draw() 的返回值必须用上：它返回 false 表示「此刻不该出现」。
        //   原来只调不管返回值，而各件的 draw 又只按 t0 算进度、不判 t1
        //   ⇒ 过了 t1 还挂在 0.95 不消失，一屏能同时亮好几个红框（2026-10-22 实测踩到）。
        var on = items[i].draw(t);
        if (!on) items[i].el.style.opacity = '0';
        else any = true;
      }
      return any;
    },

    /** 给闸门用：当前可见件（屏幕矩形 + 类型） */
    visible: function () {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var el = items[i].el, op = parseFloat(getComputedStyle(el).opacity) || 0;
        if (op < 0.05) continue;
        var b = el.getBoundingClientRect();
        out.push({ kind: items[i].kind, op: op, x: b.x, y: b.y, w: b.width, h: b.height });
      }
      return out;
    },

    count: function () { return items.length; }
  };

  global.ANNO = ANNO;
})(window);
