/*
 * chart.js — 依存ライブラリなしのSVGライントレンドチャート
 * 単位が違う指標(g / ml)は同じ軸に載せず、1枚につき1系列で描く。
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  // 上端いっぱいにならない、切りのいい軸の最大値
  function niceMax(maxValue) {
    if (maxValue <= 0) return 10;
    var raw = maxValue * 1.15;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] * mag >= raw) return steps[i] * mag;
    }
    return 10 * mag;
  }

  /*
   * container に1系列のライングラフを描く。
   * opts: { data: [{day, value}], unit, color(css var名), title, zeroBase }
   * zeroBase: false にすると軸をデータ範囲に合わせる(体重など、0からだと変化が見えない指標用)
   */
  function renderTrend(container, opts) {
    container.innerHTML = "";
    var data = opts.data;
    if (!data || data.length === 0) {
      container.innerHTML = '<p class="empty-note">この期間の記録はありません</p>';
      return;
    }
    var zeroBase = opts.zeroBase !== false;
    var W = 340, H = 150;
    var pad = { top: 14, right: 44, bottom: 22, left: 34 };
    var plotW = W - pad.left - pad.right;
    var plotH = H - pad.top - pad.bottom;

    var svg = el("svg", {
      viewBox: "0 0 " + W + " " + H,
      class: "trend-svg",
      role: "img",
      "aria-label": opts.title,
    });

    var values = data.map(function (d) { return d.value; });
    var y0, y1, ticks;
    if (zeroBase) {
      y0 = 0;
      y1 = niceMax(Math.max.apply(null, values));
      ticks = [y1 / 2, y1];
    } else {
      // データ範囲の上下に25%の余白。値の変化が読めるようにする
      var lo = Math.min.apply(null, values);
      var hi = Math.max.apply(null, values);
      var span = Math.max(hi - lo, Math.abs(hi) * 0.02, 0.1);
      y0 = Math.round((lo - span * 0.25) * 100) / 100;
      y1 = Math.round((hi + span * 0.25) * 100) / 100;
      ticks = [y0, Math.round(((y0 + y1) / 2) * 100) / 100, y1];
    }

    function x(i) { return pad.left + (data.length === 1 ? plotW / 2 : (i * plotW) / (data.length - 1)); }
    function y(v) { return pad.top + plotH - ((v - y0) / (y1 - y0)) * plotH; }

    // 控えめなグリッド + 目盛りラベル
    ticks.forEach(function (v) {
      svg.appendChild(el("line", {
        x1: pad.left, x2: W - pad.right, y1: y(v), y2: y(v),
        class: "grid-line",
      }));
      var t = el("text", { x: pad.left - 5, y: y(v) + 3.5, class: "axis-label", "text-anchor": "end" });
      t.textContent = v >= 1000 ? v / 1000 + "k" : v;
      svg.appendChild(t);
    });

    // ベースライン(下端)
    svg.appendChild(el("line", {
      x1: pad.left, x2: W - pad.right, y1: y(y0), y2: y(y0), class: "baseline",
    }));

    // X軸ラベル: 最初・中間・最後の日付だけ(重なり防止)
    var labelIdx = data.length <= 8
      ? data.map(function (_, i) { return i; })
      : [0, Math.floor((data.length - 1) / 2), data.length - 1];
    labelIdx.forEach(function (i) {
      var t = el("text", {
        x: x(i), y: H - 6, class: "axis-label",
        "text-anchor": i === 0 ? "start" : i === data.length - 1 ? "end" : "middle",
      });
      t.textContent = data[i].day.slice(5).replace("-", "/");
      svg.appendChild(t);
    });

    // 折れ線(2px)
    var points = data.map(function (d, i) { return x(i) + "," + y(d.value); }).join(" ");
    svg.appendChild(el("polyline", {
      points: points, fill: "none",
      stroke: "var(" + opts.color + ")", "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }));

    // 最終点: マーカー + 直接ラベル(色の識別を色だけに頼らせない)
    var last = data[data.length - 1];
    svg.appendChild(el("circle", {
      cx: x(data.length - 1), cy: y(last.value), r: 4,
      fill: "var(" + opts.color + ")", stroke: "var(--surface-1)", "stroke-width": 2,
    }));
    var lastLabel = el("text", {
      x: x(data.length - 1) + 7, y: y(last.value) + 3.5, class: "last-label",
    });
    lastLabel.textContent = last.value + opts.unit;
    svg.appendChild(lastLabel);

    // ---- ホバー/タップ層: クロスヘア + ツールチップ ----
    var crosshair = el("line", { class: "crosshair", y1: pad.top, y2: pad.top + plotH, visibility: "hidden" });
    var hoverDot = el("circle", {
      r: 4.5, visibility: "hidden",
      fill: "var(" + opts.color + ")", stroke: "var(--surface-1)", "stroke-width": 2,
    });
    svg.appendChild(crosshair);
    svg.appendChild(hoverDot);

    var tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;

    function showAt(i) {
      var d = data[i];
      crosshair.setAttribute("x1", x(i));
      crosshair.setAttribute("x2", x(i));
      crosshair.setAttribute("visibility", "visible");
      hoverDot.setAttribute("cx", x(i));
      hoverDot.setAttribute("cy", y(d.value));
      hoverDot.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.textContent = d.day.slice(5).replace("-", "/") + "  " + d.value + opts.unit;
      var rect = container.getBoundingClientRect();
      var px = (x(i) / W) * rect.width;
      tip.style.left = Math.min(Math.max(px, 44), rect.width - 44) + "px";
    }

    function hide() {
      crosshair.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    }

    function handle(evt) {
      var rect = svg.getBoundingClientRect();
      var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      var vx = ((clientX - rect.left) / rect.width) * W;
      var i = Math.round(((vx - pad.left) / plotW) * (data.length - 1));
      i = Math.max(0, Math.min(data.length - 1, i));
      showAt(i);
    }

    svg.addEventListener("mousemove", handle);
    svg.addEventListener("mouseleave", hide);
    svg.addEventListener("touchstart", handle, { passive: true });
    svg.addEventListener("touchmove", handle, { passive: true });
    svg.addEventListener("touchend", hide);

    container.appendChild(svg);
    container.appendChild(tip);
  }

  window.KameChart = { renderTrend: renderTrend };
})();
