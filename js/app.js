/*
 * app.js — 画面の制御
 */
(function () {
  "use strict";

  var C = KameCore;
  var S = KameStorage;

  var state = {
    tab: "record",
    type: "food",
    genre: "dry", // ごはんのジャンル("dry"|"wet")。水・おやつのときは ""
    foodFilter: "", // 設定のフード登録一覧のジャンルしぼりこみ("" = すべて)
    recordDate: "", // きろくタブで表示中の日付 "YYYY-MM-DD"("" = きょう)
    chartMonth: new Date().toISOString().slice(0, 7), // グラフ表示中の月 "YYYY-MM"
    chartMode: "week", // "week" | "day" | "range"
    chartFrom: "", chartTo: "", // 期間指定グラフの範囲 "YYYY-MM-DD"
    historyDate: "", // りれきの日付フィルタ("" = 全部)
    historyView: "list", // "list"(きろく一覧) | "album"(写真)
    stagedPhoto: null, // 「今日のかめ」で選択中の写真dataURL
    selectMode: false, // りれきの複数選択モード
    selected: {}, // 選択中の記録id → true
  };

  // りれきに現在表示中の記録id(「すべて選択」の対象)
  var historyIds = [];

  // ---- きせかえ ----

  var THEMES = [
    { id: "", label: "おまかせ", swatch: "linear-gradient(90deg, #f9f9f7 50%, #0d0d0d 50%)" },
    { id: "sakura", label: "さくら", swatch: "#f6cede" },
    { id: "sora", label: "そら", swatch: "#c3ddf3" },
    { id: "wakaba", label: "わかば", swatch: "#cbe6c6" },
    { id: "mikan", label: "みかん", swatch: "#f7ddb5" },
    { id: "yozora", label: "よぞら", swatch: "#1c2438" },
  ];

  function applyAppearance() {
    var s = S.getSettings();
    if (s.theme) document.body.dataset.theme = s.theme;
    else delete document.body.dataset.theme;
  }

  function currentMonth() {
    var d = new Date();
    var m = d.getMonth() + 1;
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m);
  }
  state.chartMonth = currentMonth();

  function shiftMonth(ym, delta) {
    var p = ym.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    var m = d.getMonth() + 1;
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m);
  }

  function $(id) { return document.getElementById(id); }

  // ---- ユーティリティ ----

  // きろくタブで表示中の日付キー("" = きょう)
  function recordDayKey() {
    return state.recordDate || C.dayKey(new Date());
  }

  // 表示中の日の「今の時刻」。前の日を見ているときはその日付+今の時刻で記録する
  function nowOnRecordDate() {
    var now = new Date();
    var key = recordDayKey();
    if (key === C.dayKey(now)) return now;
    var p = key.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
      now.getHours(), now.getMinutes(), now.getSeconds());
  }

  // datetime-local 入力用の "YYYY-MM-DDTHH:MM"(表示中の日に合わせる)
  function nowLocalForInput() {
    var d = nowOnRecordDate();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function timeLabel(ts) {
    return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function dayLabel(key) {
    var d = new Date(key + "T00:00:00");
    var youbi = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return (d.getMonth() + 1) + "/" + d.getDate() + " (" + youbi + ")";
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s == null ? "" : String(s);
    return div.innerHTML;
  }

  // プロフィールに登録した名前(未登録なら「かめ」)
  function petName() {
    return (S.getProfile().name || "").trim() || "かめ";
  }

  // いま選んでいる記録の種類の表示名(ごはんはドライ/ウェットで呼び分ける)
  function currentTypeLabel() {
    if (state.type === "food" && C.FOOD_GENRES[state.genre]) {
      return C.FOOD_GENRES[state.genre].label;
    }
    return C.TYPES[state.type].label;
  }

  // フード登録のジャンル表示名
  function genreLabel(genre) {
    if (C.FOOD_GENRES[genre]) return C.FOOD_GENRES[genre].label;
    if (genre === "snack") return "おやつ";
    return "ジャンルなし";
  }

  // 登録フードが、いま記録している種類(ドライ/ウェット/おやつ)と合うか。
  // ジャンル未設定の登録(旧データ)はどの候補にも出す
  function foodDefMatchesCurrent(f) {
    if (!f.genre) return true;
    if (state.type === "snack") return f.genre === "snack";
    return f.genre === state.genre;
  }

  // 画像を縮小してJPEGのdataURLにする(通信量・容量対策)
  function resizeImage(file, maxSize) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 写真を(ローカル→なければ同期先から)取ってきて img に入れる
  function loadPhotoInto(imgEl, photoId) {
    S.Photos.get(photoId).then(function (p) {
      if (p) {
        imgEl.src = p.dataUrl;
        imgEl.hidden = false;
        return;
      }
      return S.fetchPhoto(photoId).then(function (fetched) {
        if (fetched) {
          imgEl.src = fetched.dataUrl;
          imgEl.hidden = false;
        }
      });
    }).catch(function () {});
  }

  // ---- キーボード対応 ----

  // iOS Safariではソフトキーボードが開いてもfixed要素がキーボードを
  // 避けてくれず、タブバーが画面中央に浮いて入力欄に重なる。
  // iOSはキーボード表示時に window.innerHeight も一緒に縮むため
  // innerHeightとの差分では検知できない。そこで
  //  1) テキスト系入力へのフォーカス(=キーボードが出る操作そのもの)
  //  2) ビジュアルビューポートが「これまでの最大高さ」より大きく縮んだ
  // のどちらかでタブバーを隠す。
  function bindKeyboardWatch() {
    var tabBar = document.querySelector(".tab-bar");
    var focusHide = false;
    var viewportHide = false;

    function apply() {
      tabBar.classList.toggle("is-keyboard-open", focusHide || viewportHide);
    }

    function isTextField(el) {
      if (!el || !el.tagName) return false;
      var tag = el.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag !== "INPUT") return false;
      // 日付・selectなどはピッカーが開くだけで文字キーボードは出ない上、
      // iOSではピッカーを閉じてもフォーカスが残りタブバーが消えたままになる
      return ["checkbox", "radio", "button", "submit", "file", "range",
        "date", "month", "datetime-local", "time"].indexOf(el.type) < 0;
    }

    document.addEventListener("focusin", function (e) {
      focusHide = isTextField(e.target);
      apply();
    });
    document.addEventListener("focusout", function () {
      // 次の欄への移動なら直後にfocusinが来るので、少し待ってから判定
      setTimeout(function () {
        focusHide = isTextField(document.activeElement);
        apply();
      }, 80);
    });

    if (window.visualViewport) {
      var vv = window.visualViewport;
      var baseHeight = vv.height; // キーボードが出ていないときの基準の高さ
      var restoreTimer = null;
      vv.addEventListener("resize", function () {
        if (!isTextField(document.activeElement)) {
          // テキスト入力中でなければキーボードの縮みではない
          // (ウィンドウの縮小・ピンチズーム等)。ここで基準を取り直さないと、
          // 縮めた画面でタブバーが消えたままになる
          baseHeight = vv.height;
          viewportHide = false;
          apply();
          return;
        }
        baseHeight = Math.max(baseHeight, vv.height);
        viewportHide = baseHeight - vv.height > 150;
        clearTimeout(restoreTimer);
        if (!viewportHide) {
          // ビューポートが元の高さに戻った=キーボードは閉じている。
          // iOSはキーボードを畳んでもblurが起きないことがあり、
          // フォーカス由来の非表示が残ってタブバーが消えたままになるため、
          // 少し待って安定していたら強制的に表示に戻す。
          restoreTimer = setTimeout(function () {
            focusHide = false;
            apply();
          }, 250);
        }
        apply();
      });
      // 画面回転で基準の高さが変わるためリセット
      window.addEventListener("orientationchange", function () {
        baseHeight = 0;
        viewportHide = false;
        apply();
      });
    }
  }

  // ---- タブ切り替え ----

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach(function (sec) {
      sec.hidden = sec.id !== "tab-" + tab;
    });
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });
    render();
  }

  // ---- 描画 ----

  // ヘッダーのタイトル: プロフィールの名前+ちゃん日記(未設定ならペット日記)
  function updateAppTitle() {
    var name = (S.getProfile().name || "").trim();
    // すでに「〜ちゃん」「〜くん」「〜さん」で終わる名前には付け足さない
    var honorific = /(ちゃん|くん|さん)$/.test(name) ? "" : "ちゃん";
    var title = name ? name + honorific + "日記" : "ペット日記";
    $("app-title").textContent = "🐱 " + title;
    document.title = title;
  }

  function render() {
    updateAppTitle();
    var records = C.liveRecords(S.getRecords());
    if (state.tab === "record") renderToday(records);
    if (state.tab === "charts") renderCharts(records);
    if (state.tab === "history") renderHistory(records);
    if (state.tab === "mypage") renderMypage(records);
    if (state.tab === "settings") renderSettings();
  }

  function recordItem(r, selectable) {
    var li = document.createElement("li");
    li.className = "record-item";
    var selecting = selectable && state.selectMode;

    var main = document.createElement("div");
    main.className = "record-main";

    if (r.type === "toilet") {
      var isPoop = r.label === "poop";
      main.innerHTML =
        "<div>" + (isPoop ? "うんち" : "おしっこ") + "</div>" +
        '<div class="record-meta">' + escapeHtml([timeLabel(r.ts), r.by].filter(Boolean).join(" · ")) + "</div>";
      li.innerHTML = '<span class="record-emoji">' + (isPoop ? "💩" : "💦") + "</span>";
      li.appendChild(main);
    } else if (r.type === "diary") {
      var meta = [timeLabel(r.ts), r.by].filter(Boolean).join(" · ");
      main.innerHTML =
        "<div>" + (r.note ? escapeHtml(r.note) : "この日の" + escapeHtml(petName())) +
        (Number(r.weight) > 0 ? ' <span class="record-meta">体重 ' + r.weight + "kg</span>" : "") +
        (Number(r.temp) > 0 ? ' <span class="record-meta">体温 ' + r.temp + "℃</span>" : "") +
        "</div>" +
        '<div class="record-meta">' + escapeHtml(meta) + "</div>";
      li.innerHTML = '<span class="record-emoji">📷</span>';
      li.appendChild(main);
      if (r.photoId) {
        var img = document.createElement("img");
        img.className = "record-photo";
        img.alt = petName() + "の写真";
        img.hidden = true;
        main.appendChild(img);
        loadPhotoInto(img, r.photoId);
      }
    } else {
      var t = C.TYPES[r.type] || C.TYPES.food;
      var emoji = t.emoji;
      var typeLabel = t.label;
      // ごはんはジャンル(ドライ/ウェット)で呼び分ける。旧レコードは「ごはん」のまま
      if (r.type === "food" && C.FOOD_GENRES[r.genre]) {
        emoji = C.FOOD_GENRES[r.genre].emoji;
        typeLabel = C.FOOD_GENRES[r.genre].label;
      }
      var parts = [timeLabel(r.ts), r.label, r.note, r.by].filter(Boolean).join(" · ");
      main.innerHTML =
        '<div><span class="record-amount">' + r.amount + " " + t.unit + "</span>" +
        ' <span class="record-meta">' + typeLabel + "</span></div>" +
        '<div class="record-meta">' + escapeHtml(parts) + "</div>";
      li.innerHTML = '<span class="record-emoji">' + emoji + "</span>";
      li.appendChild(main);
    }

    if (selecting) {
      // 選択モード: 先頭にチェックボックス、行のどこを押しても選択できる
      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "record-check";
      check.checked = !!state.selected[r.id];
      check.setAttribute("aria-label", "この記録を選択");
      check.addEventListener("change", function () {
        if (check.checked) state.selected[r.id] = true;
        else delete state.selected[r.id];
        updateSelectBar();
      });
      li.insertBefore(check, li.firstChild);
      li.classList.add("is-selectable");
      li.addEventListener("click", function (e) {
        if (e.target === check) return;
        check.checked = !check.checked;
        check.dispatchEvent(new Event("change"));
      });
      return li;
    }

    var del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "✕";
    del.setAttribute("aria-label", "この記録を削除");
    del.addEventListener("click", function () {
      if (confirm("この記録を削除しますか?")) {
        S.remove(r.id);
        render();
      }
    });
    li.appendChild(del);
    return li;
  }

  function listable(records) {
    return records.filter(function (r) {
      return r.type !== "profile" && r.type !== "fooddefs";
    });
  }

  function renderToday(records) {
    var key = recordDayKey();
    var isToday = key === C.dayKey(new Date());

    // 日付ナビと見出し(きょう以外を見ているときは文言を変える)
    $("record-date-label").textContent = isToday ? "きょう" : dayLabel(key);
    $("record-date").value = key;
    $("day-next").disabled = isToday;
    $("tile-food-label").textContent = isToday ? "今日のごはん" : "この日のごはん";
    $("tile-water-label").textContent = isToday ? "今日の水" : "この日の水";
    $("diary-card-title").textContent = "📷 " + (isToday ? "今日の" : "この日の") + petName();

    var todays = listable(records).filter(function (r) { return C.dayKey(r.ts) === key; });

    var totals = C.dailyTotals(todays)[key] || { food: 0, foodDry: 0, foodWet: 0, water: 0, snack: 0 };
    $("today-food").textContent = totals.food;
    $("today-water").textContent = totals.water;

    // ごはんタイルにドライ/ウェットの内訳(どちらかの記録があるときだけ)
    var genreSub = $("today-food-genres");
    if (totals.foodDry > 0 || totals.foodWet > 0) {
      genreSub.textContent = "ドライ " + totals.foodDry + " · ウェット " + totals.foodWet;
      genreSub.hidden = false;
    } else {
      genreSub.hidden = true;
    }

    var toilet = C.dailyToiletCounts(records)[key] || { pee: 0, poop: 0 };
    $("toilet-pee-count").textContent = toilet.pee;
    $("toilet-poop-count").textContent = toilet.poop;

    // この日のカロリー(カロリー登録があるフードの分だけ。タイルは常に表示)
    var kcal = C.dailyKcal(records, S.getFoods())[key] || 0;
    $("today-kcal").textContent = Math.round(kcal);

    // 入力途中(未保存)の内容を消さないよう、編集中は行を作り直さない
    if (!isBowlAreaDirty()) rebuildBowlRows(records);

    var list = $("today-diary-list");
    list.innerHTML = "";
    todays
      .filter(function (r) { return r.type === "diary"; })
      .sort(function (a, b) { return a.ts < b.ts ? 1 : -1; })
      .forEach(function (r) { list.appendChild(recordItem(r)); });
  }

  function renderCharts(records) {
    var ym = state.chartMonth;
    $("chart-month").value = ym;
    var todayKey = C.dayKey(new Date());
    var isRange = state.chartMode === "range";

    // 期間指定のときは月ナビと週平均表のかわりに、はじまり・おわりの入力を出す
    $("chart-month-nav").hidden = isRange;
    $("range-inputs").hidden = !isRange;
    $("week-avg-card").hidden = isRange;
    $("range-from").value = state.chartFrom;
    $("range-to").value = state.chartTo;

    // 未来の日・週は0として描かない
    var weeks = isRange ? [] : C.weeklyStatsForMonth(records, ym).filter(function (w) {
      return w.start <= todayKey;
    });
    var foods = S.getFoods();
    var kcalMap = C.dailyKcal(records, foods);
    var kcalFoodMap = C.dailyKcal(records, foods, "food");
    var kcalSnackMap = C.dailyKcal(records, foods, "snack");
    var s = {};

    if (state.chartMode !== "week") {
      // 日ごと(その月)または期間指定(はじまり〜おわり)の日別折れ線
      var days = (isRange
        ? C.daysInRange(records, state.chartFrom, state.chartTo)
        : C.daysOfMonth(records, ym)
      ).filter(function (d) { return d.day <= todayKey; });
      var inShown = function (p) {
        if (isRange) return p.day >= state.chartFrom && p.day <= state.chartTo && p.day <= todayKey;
        return p.day.slice(0, 7) === ym;
      };
      var dayKcalSeries = function (map) {
        return days.map(function (d) { return { day: d.day, value: Math.round(map[d.day] || 0) }; });
      };
      s.food = days.map(function (d) { return { day: d.day, value: d.food }; });
      s.foodDry = days.map(function (d) { return { day: d.day, value: d.foodDry || 0 }; });
      s.foodWet = days.map(function (d) { return { day: d.day, value: d.foodWet || 0 }; });
      s.water = days.map(function (d) { return { day: d.day, value: d.water }; });
      s.snack = days.map(function (d) { return { day: d.day, value: d.snack }; });
      s.kcal = dayKcalSeries(kcalMap);
      s.kcalFood = dayKcalSeries(kcalFoodMap);
      s.kcalSnack = dayKcalSeries(kcalSnackMap);
      s.weight = C.weightSeries(records).filter(inShown);
      s.temp = C.tempSeries(records).filter(inShown);
    } else {
      // カロリーの週平均(記録がある日だけで平均)
      var weekKcalSeries = function (map) {
        return weeks.map(function (w) {
          var start = new Date(w.start + "T00:00:00");
          var sum = 0, days = 0;
          for (var i = 0; i < 7; i++) {
            var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            var v = map[C.dayKey(d)] || 0;
            if (v > 0) { sum += v; days++; }
          }
          return { day: w.start, value: days ? Math.round(sum / days) : 0 };
        });
      };
      s.food = weeks.map(function (w) { return { day: w.start, value: w.food }; });
      s.foodDry = weeks.map(function (w) { return { day: w.start, value: w.foodDry || 0 }; });
      s.foodWet = weeks.map(function (w) { return { day: w.start, value: w.foodWet || 0 }; });
      s.water = weeks.map(function (w) { return { day: w.start, value: w.water }; });
      s.snack = weeks.map(function (w) { return { day: w.start, value: w.snack }; });
      s.kcal = weekKcalSeries(kcalMap);
      s.kcalFood = weekKcalSeries(kcalFoodMap);
      s.kcalSnack = weekKcalSeries(kcalSnackMap);
      s.weight = weeks.filter(function (w) { return w.weight > 0; })
        .map(function (w) { return { day: w.start, value: w.weight }; });
      s.temp = weeks.filter(function (w) { return w.temp > 0; })
        .map(function (w) { return { day: w.start, value: w.temp }; });
    }

    var perDay = state.chartMode === "week" ? " / 日の週平均" : " / 日";
    var hasValue = function (series) {
      return series.some(function (d) { return d.value > 0; });
    };

    // 各グラフの定義。has=false のものはトグルにも出さない
    var chartDefs = [
      { key: "food", card: "food-card", box: "chart-food", label: "ごはん", swatch: "--series-food",
        has: true, opts: { data: s.food, unit: "g", color: "--series-food", title: "ごはん(合算)" + perDay } },
      { key: "foodDry", card: "food-dry-card", box: "chart-food-dry", label: "ドライ", swatch: "--series-dry",
        has: hasValue(s.foodDry), opts: { data: s.foodDry, unit: "g", color: "--series-dry", title: "ドライ" + perDay } },
      { key: "foodWet", card: "food-wet-card", box: "chart-food-wet", label: "ウェット", swatch: "--series-wet",
        has: hasValue(s.foodWet), opts: { data: s.foodWet, unit: "g", color: "--series-wet", title: "ウェット" + perDay } },
      { key: "water", card: "water-card", box: "chart-water", label: "水", swatch: "--series-water",
        has: true, opts: { data: s.water, unit: "ml", color: "--series-water", title: "水" + perDay } },
      { key: "snack", card: "snack-card", box: "chart-snack", label: "おやつ", swatch: "--series-snack",
        has: hasValue(s.snack), opts: { data: s.snack, unit: "g", color: "--series-snack", title: "おやつ" + perDay } },
      { key: "kcal", card: "kcal-card", box: "chart-kcal", label: "合計kcal", swatch: "--series-kcal",
        has: hasValue(s.kcal), opts: { data: s.kcal, unit: "kcal", color: "--series-kcal", title: "カロリー合計" + perDay } },
      { key: "kcalFood", card: "kcal-food-card", box: "chart-kcal-food", label: "ごはんkcal", swatch: "--series-food",
        has: hasValue(s.kcalFood), opts: { data: s.kcalFood, unit: "kcal", color: "--series-food", title: "ごはんのカロリー" + perDay } },
      { key: "kcalSnack", card: "kcal-snack-card", box: "chart-kcal-snack", label: "おやつkcal", swatch: "--series-snack",
        has: hasValue(s.kcalSnack), opts: { data: s.kcalSnack, unit: "kcal", color: "--series-snack", title: "おやつのカロリー" + perDay } },
      { key: "weight", card: "weight-card", box: "chart-weight", label: "体重", swatch: "--series-weight",
        has: s.weight.length > 0,
        opts: { data: s.weight, unit: "kg", color: "--series-weight", title: "体重の推移",
          zeroBase: false /* 0起点だと数百gの増減が見えないため */ } },
      { key: "temp", card: "temp-card", box: "chart-temp", label: "体温", swatch: "--series-temp",
        has: s.temp.length > 0,
        opts: { data: s.temp, unit: "℃", color: "--series-temp", title: "体温の推移",
          zeroBase: false /* 平熱まわりの小さな変化を見るため */ } },
    ];

    var chartHidden = S.getSettings().chartHidden || {};
    chartDefs.forEach(function (c) {
      var visible = c.has && !chartHidden[c.key];
      $(c.card).hidden = !visible;
      if (visible) KameChart.renderTrend($(c.box), c.opts);
    });
    renderChartToggles(chartDefs, chartHidden);

    var tbody = $("week-table-body");
    tbody.innerHTML = "";
    weeks.forEach(function (w) {
      var d = new Date(w.start + "T00:00:00");
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (d.getMonth() + 1) + "/" + d.getDate() + "〜</td>" +
        "<td>" + (w.days ? w.food + " g" : "—") + "</td>" +
        "<td>" + (w.days ? w.water + " ml" : "—") + "</td>" +
        "<td>" + w.days + "日</td>";
      tbody.appendChild(tr);
    });
  }

  // データがあるグラフのON/OFFトグル(ピル)を描く
  function renderChartToggles(chartDefs, chartHidden) {
    var box = $("chart-toggle");
    box.innerHTML = "";
    chartDefs.forEach(function (c) {
      if (!c.has) return;
      var on = !chartHidden[c.key];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chart-toggle-btn" + (on ? " is-on" : "");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      var sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = "var(" + c.swatch + ")";
      btn.appendChild(sw);
      btn.appendChild(document.createTextNode(c.label));
      btn.addEventListener("click", function () {
        var st = S.getSettings();
        st.chartHidden = st.chartHidden || {};
        st.chartHidden[c.key] = !st.chartHidden[c.key];
        S.setSettings(st);
        render();
      });
      box.appendChild(btn);
    });
  }

  function renderHistory(records) {
    var isAlbum = state.historyView === "album";
    document.querySelectorAll("#tab-history .range-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === state.historyView);
    });
    $("select-bar").hidden = isAlbum;
    $("history-list-box").hidden = isAlbum;
    $("album-box").hidden = !isAlbum;
    $("history-clear").hidden = !state.historyDate;
    if (isAlbum) {
      renderAlbum(records);
      return;
    }

    var box = $("history-list-box");
    box.innerHTML = "";
    historyIds = [];

    var target = listable(records);
    if (state.historyDate) {
      target = target.filter(function (r) { return C.dayKey(r.ts) === state.historyDate; });
      if (target.length === 0) {
        box.innerHTML = '<p class="empty-note">' + dayLabel(state.historyDate) + " の記録はありません</p>";
        updateSelectBar();
        return;
      }
    }
    if (target.length === 0) {
      box.innerHTML = '<p class="empty-note">記録がたまると、ここで振り返れます</p>';
      updateSelectBar();
      return;
    }

    var totals = C.dailyTotals(target);
    var byDay = {};
    target.forEach(function (r) {
      var k = C.dayKey(r.ts);
      (byDay[k] = byDay[k] || []).push(r);
    });
    Object.keys(byDay).sort().reverse().slice(0, 60).forEach(function (k) {
      var head = document.createElement("div");
      head.className = "day-header";
      var t = totals[k] || { food: 0, water: 0 };
      head.innerHTML =
        "<span>" + dayLabel(k) + "</span>" +
        '<span class="day-totals">🍚 ' + t.food + "g · 💧 " + t.water + "ml</span>";
      box.appendChild(head);
      var ul = document.createElement("ul");
      ul.className = "record-list";
      byDay[k]
        .sort(function (a, b) { return a.ts < b.ts ? 1 : -1; })
        .forEach(function (r) {
          historyIds.push(r.id);
          ul.appendChild(recordItem(r, true));
        });
      box.appendChild(ul);
    });
    updateSelectBar();
  }

  function updateSelectBar() {
    $("select-mode").hidden = state.selectMode;
    $("select-all").hidden = !state.selectMode;
    $("select-delete").hidden = !state.selectMode;
    $("select-cancel").hidden = !state.selectMode;
    $("select-mode").disabled = historyIds.length === 0;
    if (!state.selectMode) return;
    var n = Object.keys(state.selected).length;
    var allSelected = historyIds.length > 0 && historyIds.every(function (id) {
      return state.selected[id];
    });
    $("select-all").textContent = allSelected ? "選択を解除" : "すべて選択";
    $("select-delete").textContent = "🗑 削除 (" + n + ")";
  }

  // ---- アルバム(写真の一覧と拡大表示) ----

  // アルバムに表示中の写真(ライトボックスの前後めくりで使う)
  var albumEntries = [];
  var lightboxIndex = 0;

  function renderAlbum(records) {
    var box = $("album-box");
    box.innerHTML = "";
    albumEntries = C.photoEntries(records);
    if (state.historyDate) {
      albumEntries = albumEntries.filter(function (e) { return e.day === state.historyDate; });
    }
    if (albumEntries.length === 0) {
      box.innerHTML = '<p class="empty-note">' + (state.historyDate
        ? dayLabel(state.historyDate) + " の写真はありません"
        : "まだ写真がありません。きろくの「今日の" + escapeHtml(petName()) + "」で写真を残すと、ここに並びます") +
        "</p>";
      return;
    }
    albumEntries.forEach(function (entry, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "album-item";
      btn.setAttribute("aria-label", dayLabel(entry.day) + " の写真を大きく見る");
      var img = document.createElement("img");
      img.alt = "";
      img.hidden = true;
      loadPhotoInto(img, entry.photoId);
      btn.appendChild(img);
      var date = document.createElement("span");
      date.className = "album-date";
      date.textContent = entry.day.slice(5).replace("-", "/");
      btn.appendChild(date);
      btn.addEventListener("click", function () { openLightbox(i); });
      box.appendChild(btn);
    });
  }

  function openLightbox(i) {
    lightboxIndex = i;
    updateLightbox();
    $("lightbox").hidden = false;
  }

  function updateLightbox() {
    var entry = albumEntries[lightboxIndex];
    if (!entry) return;
    var img = $("lightbox-img");
    img.hidden = true;
    img.removeAttribute("src");
    loadPhotoInto(img, entry.photoId);
    $("lightbox-caption").textContent =
      [dayLabel(entry.day), entry.note, entry.by].filter(Boolean).join(" · ");
    // アルバムは新しい順なので、◀=ひとつ新しい写真 / ▶=ひとつ古い写真
    $("lightbox-prev").disabled = lightboxIndex === 0;
    $("lightbox-next").disabled = lightboxIndex === albumEntries.length - 1;
  }

  function bindAlbum() {
    $("lightbox-close").addEventListener("click", function () {
      $("lightbox").hidden = true;
    });
    // 写真の外側をタップしても閉じる
    $("lightbox").addEventListener("click", function (e) {
      if (e.target === $("lightbox")) $("lightbox").hidden = true;
    });
    $("lightbox-prev").addEventListener("click", function () {
      if (lightboxIndex > 0) { lightboxIndex--; updateLightbox(); }
    });
    $("lightbox-next").addEventListener("click", function () {
      if (lightboxIndex < albumEntries.length - 1) { lightboxIndex++; updateLightbox(); }
    });
  }

  function renderMypage(records) {
    var p = S.getProfile();
    $("profile-name-display").textContent = p.name || "名前未登録";

    var sub = [];
    if (p.sex) sub.push(p.sex);
    var age = C.ageLabel(p.birth);
    if (age) sub.push(age);
    if (p.breed) sub.push(p.breed);
    var ws = C.weightSeries(records);
    if (ws.length) sub.push("体重 " + ws[ws.length - 1].value + "kg");
    $("profile-sub").textContent = sub.join(" · ") || "プロフィールを登録してください";

    var avatarImg = $("avatar-img");
    var avatarHint = $("avatar-hint");
    if (p.avatarPhotoId) {
      loadPhotoInto(avatarImg, p.avatarPhotoId);
      avatarHint.hidden = true;
    } else {
      avatarImg.hidden = true;
      avatarHint.hidden = false;
    }

    // 健康チェック(アイコン+文言。色だけに頼らない)
    var list = $("health-list");
    list.innerHTML = "";
    C.healthCheck(records).forEach(function (c) {
      var li = document.createElement("li");
      li.className = "health-item is-" + c.level;
      var icon = c.level === "good" ? "✅" : c.level === "warning" ? "⚠️" : "ℹ️";
      li.innerHTML = "<span>" + icon + "</span><span>" + escapeHtml(c.message) + "</span>";
      list.appendChild(li);
    });

    // 編集フォーム
    $("p-name").value = p.name || "";
    $("p-sex").value = p.sex || "";
    // 旧データは"YYYY-MM"形式なので、日付inputに入るよう1日として補完する
    var birth = p.birth || "";
    if (/^\d{4}-\d{2}$/.test(birth)) birth += "-01";
    $("p-birth").value = birth;
    $("p-breed").value = p.breed || "";
    $("p-diseases").value = p.diseases || "";
  }

  // きせかえの選択ボタン(背景・フォント)を描く
  function renderAppearanceChoices() {
    var s = S.getSettings();

    var themeBox = $("theme-select");
    themeBox.innerHTML = "";
    THEMES.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn" + ((s.theme || "") === t.id ? " is-active" : "");
      var sw = document.createElement("span");
      sw.className = "choice-swatch";
      sw.style.background = t.swatch;
      btn.appendChild(sw);
      btn.appendChild(document.createTextNode(t.label));
      btn.addEventListener("click", function () {
        var cur = S.getSettings();
        cur.theme = t.id;
        S.setSettings(cur);
        applyAppearance();
        renderAppearanceChoices();
      });
      themeBox.appendChild(btn);
    });
  }

  function renderSettings() {
    var s = S.getSettings();
    renderAppearanceChoices();
    $("setting-by").value = s.by || "";
    $("setting-gas-url").value = s.gasUrl || "";
    $("setting-gas-token").value = s.gasToken || "";
    $("record-count").textContent = C.liveRecords(S.getRecords()).length;

    // フード登録の一覧(ジャンルでしぼりこめる)
    document.querySelectorAll("#food-filter .range-btn").forEach(function (b) {
      b.classList.toggle("is-active", (b.dataset.genre || "") === state.foodFilter);
    });
    var foods = S.getFoods();
    var shown = state.foodFilter
      ? foods.filter(function (f) { return (f.genre || "") === state.foodFilter; })
      : foods;
    var ul = $("food-defs");
    ul.innerHTML = "";
    if (shown.length === 0) {
      ul.innerHTML = '<p class="empty-note">' +
        (foods.length === 0 ? "まだ登録がありません" : "このジャンルの登録はありません") + "</p>";
    }
    shown.forEach(function (f) {
      var li = document.createElement("li");
      li.className = "food-def-item";
      var info = [];
      if (f.amount) info.push(f.amount + " g");
      if (f.kcal100) info.push(f.kcal100 + " kcal/100g");
      li.innerHTML =
        '<span class="food-def-name">' + escapeHtml(f.name) + "</span>" +
        '<span class="food-def-genre">' + genreLabel(f.genre) + "</span>" +
        '<span class="food-def-amount">' + info.join(" · ") + "</span>";
      var del = document.createElement("button");
      del.className = "delete-btn";
      del.textContent = "✕";
      del.setAttribute("aria-label", f.name + " の登録を削除");
      del.addEventListener("click", function () {
        S.setFoods(S.getFoods().filter(function (x) { return x.name !== f.name; }));
        renderSettings();
      });
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  // フード名欄に独自の候補ドロップダウンを付ける。
  // (<datalist>はiOS Safariでドロップダウン表示されず実質使えないため)
  function attachFoodSuggest(nameInput, row) {
    var panel = document.createElement("div");
    panel.className = "food-suggest";
    panel.hidden = true;
    nameInput.parentElement.appendChild(panel);

    function refresh() {
      var q = nameInput.value.trim();
      // いま記録している種類(ドライ/ウェット/おやつ)とジャンルが合うものだけ候補に出す
      var hits = S.getFoods().filter(function (f) {
        if (q && f.name.indexOf(q) < 0) return false;
        return foodDefMatchesCurrent(f);
      });
      panel.innerHTML = "";
      if (hits.length === 0) {
        panel.hidden = true;
        return;
      }
      hits.forEach(function (f) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "food-suggest-item";
        btn.innerHTML = escapeHtml(f.name) +
          (f.amount ? '<span class="food-suggest-amount">' + f.amount + " g</span>" : "");
        // 押した瞬間に入力欄のフォーカスが外れてパネルが消えないようにする
        btn.addEventListener("pointerdown", function (ev) { ev.preventDefault(); });
        btn.addEventListener("click", function () {
          nameInput.value = f.name;
          var given = row.querySelector(".in-given");
          if (f.amount && !given.value) given.value = f.amount;
          panel.hidden = true;
          updateTotalPreview();
        });
        panel.appendChild(btn);
      });
      panel.hidden = false;
    }

    nameInput.addEventListener("focus", refresh);
    nameInput.addEventListener("input", refresh);
    nameInput.addEventListener("blur", function () {
      setTimeout(function () { panel.hidden = true; }, 150);
    });
  }

  // ---- 入力フォーム(複数のお皿。今日の保存済みの分も行として残り、編集できる) ----

  function bowlItems() {
    return Array.prototype.slice.call(document.querySelectorAll("#bowl-rows .bowl-item"));
  }

  function rowValues(item) {
    return {
      label: item.querySelector(".in-name").value.trim(),
      given: item.querySelector(".in-given").value,
      left: item.querySelector(".in-left").value,
    };
  }

  function isRowChanged(item) {
    var v = rowValues(item);
    if (!item.dataset.id) return v.label !== "" || v.given !== "" || v.left !== "";
    return v.label !== (item.dataset.oLabel || "") ||
      v.given !== (item.dataset.oGiven || "") ||
      v.left !== (item.dataset.oLeft || "");
  }

  // 未保存の入力があるか(あるときは行の作り直しをしない)
  function isBowlAreaDirty() {
    return bowlItems().some(isRowChanged);
  }

  function addBowlRow(record) {
    var unit = C.TYPES[state.type].unit;
    var isFood = state.type !== "water";

    var item = document.createElement("div");
    item.className = "bowl-item" + (record ? " is-saved" : "");

    if (record) {
      item.dataset.id = record.id;
      item.dataset.oLabel = record.label || "";
      item.dataset.oGiven = record.given ? String(record.given) : "";
      item.dataset.oLeft = record.left ? String(record.left) : "";
      var metaParts = [timeLabel(record.ts), record.by, record.note].filter(Boolean);
      // ジャンルのない昔のごはん記録はドライ・ウェット両方に出るので、それと分かるようにする
      if (record.type === "food" && !C.FOOD_GENRES[record.genre]) metaParts.push("ジャンルなし");
      var meta = document.createElement("div");
      meta.className = "bowl-row-meta";
      meta.textContent = "✔ " + metaParts.join(" · ");
      item.appendChild(meta);
    }

    var namePlaceholder = state.type === "snack" ? "ちゅ〜る"
      : state.genre === "wet" ? "パウチ" : "カリカリ";
    var row = document.createElement("div");
    row.className = "bowl-row";
    row.innerHTML =
      '<label class="bowl-name">' + (isFood ? "フード名" : "場所(任意)") +
      '<input type="text" class="in-name"' +
      ' placeholder="' + (isFood ? namePlaceholder : "リビング") + '"></label>' +
      "<label>あげた量 " + unit +
      '<input type="number" class="in-given" inputmode="decimal" min="0" step="0.1" placeholder="50"></label>' +
      "<label>残した量 " + unit +
      '<input type="number" class="in-left" inputmode="decimal" min="0" step="0.1" placeholder="0"></label>';

    if (record) {
      row.querySelector(".in-name").value = record.label || "";
      row.querySelector(".in-given").value = item.dataset.oGiven;
      row.querySelector(".in-left").value = item.dataset.oLeft;
    }

    var del = document.createElement("button");
    del.type = "button";
    del.className = "row-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", "このお皿を削除");
    del.addEventListener("click", function () {
      if (record) {
        if (!confirm("この記録を削除しますか?")) return;
        S.remove(record.id);
        rebuildBowlRows();
        render();
      } else {
        item.remove();
        if (bowlItems().length === 0) addBowlRow();
        updateTotalPreview();
      }
    });
    row.appendChild(del);

    // 登録済みフードを選んだら「いつもの量」を自動入力
    row.querySelector(".in-name").addEventListener("input", function (e) {
      var def = S.getFoods().find(function (f) { return f.name === e.target.value; });
      var givenInput = row.querySelector(".in-given");
      if (def && def.amount && !givenInput.value) {
        givenInput.value = def.amount;
        updateTotalPreview();
      }
    });
    row.querySelector(".in-given").addEventListener("input", updateTotalPreview);
    row.querySelector(".in-left").addEventListener("input", updateTotalPreview);

    if (isFood) attachFoodSuggest(row.querySelector(".in-name"), row);

    item.appendChild(row);

    // 登録フードなら、このお皿ぶんのカロリーを下に表示する
    if (isFood) {
      var kcalNote = document.createElement("div");
      kcalNote.className = "bowl-kcal";
      kcalNote.hidden = true;
      item.appendChild(kcalNote);
    }

    $("bowl-rows").appendChild(item);
  }

  // 表示中の日の保存済み記録(選択中の種類)を行として並べる
  function rebuildBowlRows(records) {
    $("bowl-rows").innerHTML = "";
    var key = recordDayKey();
    var saved = C.liveRecords(records || S.getRecords())
      .filter(function (r) {
        if (r.type !== state.type || C.dayKey(r.ts) !== key) return false;
        // ごはんはジャンルで分けて表示。ジャンルのない旧レコードはどちらにも出す
        if (state.type === "food" && C.FOOD_GENRES[r.genre]) return r.genre === state.genre;
        return true;
      })
      .sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
    saved.forEach(function (r) { addBowlRow(r); });
    if (saved.length === 0) addBowlRow();
    updateTotalPreview();
  }

  function updateTotalPreview() {
    var unit = C.TYPES[state.type].unit;
    var items = bowlItems();
    var amounts = items.map(function (item) {
      var v = rowValues(item);
      return C.consumed(v.given, v.left);
    }).filter(function (v, i) { return rowValues(items[i]).given !== ""; });

    // お皿ごとのカロリー(登録フードのみ)を更新しつつ合計する
    var foods = S.getFoods();
    var totalKcal = 0;
    var hasKcal = false;
    items.forEach(function (item) {
      var note = item.querySelector(".bowl-kcal");
      if (!note) return;
      var v = rowValues(item);
      var def = foods.find(function (f) {
        return f.name === v.label && Number(f.kcal100) > 0;
      });
      if (def && v.given !== "") {
        var kc = Math.round(C.consumed(v.given, v.left) * def.kcal100 / 100);
        note.textContent = "約 " + kc + " kcal";
        note.hidden = false;
        totalKcal += kc;
        hasKcal = true;
      } else {
        note.hidden = true;
      }
    });

    var p = $("consumed-preview");
    if (amounts.length === 0) {
      p.hidden = true;
      return;
    }
    var total = Math.round(amounts.reduce(function (a, b) { return a + b; }, 0) * 10) / 10;
    var prefix = recordDayKey() === C.dayKey(new Date()) ? "今日の" : "この日の";
    p.hidden = false;
    p.textContent = prefix + currentTypeLabel() + " 合計 " + total + " " + unit +
      (amounts.length > 1 ? "(" + amounts.join(" + ") + ")" : "") +
      (hasKcal ? " · 約 " + totalKcal + " kcal" : "");
  }

  function bindForm() {
    document.querySelectorAll(".type-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var genre = btn.dataset.genre || "";
        if (state.type === btn.dataset.type && state.genre === genre) return;
        if (isBowlAreaDirty() && !confirm("保存していない入力があります。切り替えますか?")) return;
        state.type = btn.dataset.type;
        state.genre = genre;
        document.querySelectorAll(".type-btn").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        rebuildBowlRows();
      });
    });

    $("add-row").addEventListener("click", function () {
      addBowlRow();
    });

    $("record-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var ts = new Date($("ts").value || Date.now()).toISOString();
      var by = $("by").value.trim();
      var note = $("note").value.trim();
      var saved = 0;
      var firstNew = true;
      var all = S.getRecords();

      bowlItems().forEach(function (item) {
        if (!isRowChanged(item)) return;
        var v = rowValues(item);
        var given = Number(v.given);
        if (!(given > 0)) return; // 量を消したい場合は行の✕で削除する
        var left = Number(v.left) || 0;

        if (item.dataset.id) {
          // 保存済みの行の編集(日時・記録した人・メモは元のまま)
          var rec = all.find(function (r) { return r.id === item.dataset.id; });
          if (!rec) return;
          rec.label = v.label;
          rec.given = given;
          rec.left = left;
          rec.amount = C.consumed(given, left);
          S.upsert(rec, true);
        } else {
          S.upsert({
            id: C.uuid(),
            ts: ts,
            type: state.type,
            genre: state.type === "food" ? state.genre : "",
            label: v.label,
            given: given,
            left: left,
            amount: C.consumed(given, left),
            note: firstNew ? note : "", // メモは新しい1件目に付ける
            by: by,
          }, true);
          firstNew = false;
        }
        saved++;
      });

      if (saved === 0) return;
      S.trySync();

      if (by) {
        var s = S.getSettings();
        s.by = by;
        S.setSettings(s);
      }

      $("note").value = "";
      $("ts").value = nowLocalForInput();
      rebuildBowlRows();
      render();
    });
  }

  // ---- きろくの日付ナビ ----

  function setRecordDate(key) {
    if (isBowlAreaDirty() && !confirm("保存していない入力があります。日付を変えますか?")) {
      $("record-date").value = recordDayKey(); // 表示を元に戻す
      return;
    }
    var todayKey = C.dayKey(new Date());
    if (!key || key >= todayKey) key = ""; // 未来の日は選べない(きょうに丸める)
    state.recordDate = key;
    $("ts").value = nowLocalForInput();
    rebuildBowlRows();
    render();
  }

  function bindRecordDate() {
    $("day-prev").addEventListener("click", function () {
      setRecordDate(C.shiftDay(recordDayKey(), -1));
    });
    $("day-next").addEventListener("click", function () {
      setRecordDate(C.shiftDay(recordDayKey(), 1));
    });
    // 透明にした日付inputがタップを拾えない環境向けの保険(りれきと同じ)
    $("record-date").parentElement.addEventListener("click", function (e) {
      var input = $("record-date");
      if (e.target !== input && input.showPicker) {
        try { input.showPicker(); } catch (err) {}
      }
    });
    $("record-date").addEventListener("change", function (e) {
      setRecordDate(e.target.value);
    });
  }

  // ---- 今日のかめ(日記) ----

  function bindDiary() {
    $("photo-input").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      resizeImage(file, 1000).then(function (dataUrl) {
        state.stagedPhoto = dataUrl;
        var img = $("photo-preview");
        img.src = dataUrl;
        img.hidden = false;
        $("photo-pick-hint").hidden = true;
      }).catch(function () {
        alert("写真を読み込めませんでした");
      });
      e.target.value = "";
    });

    $("diary-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var note = $("diary-note").value.trim();
      var weight = Number($("diary-weight").value) || 0;
      var temp = Number($("diary-temp").value) || 0;
      if (!note && !weight && !temp && !state.stagedPhoto) return;

      var record = {
        id: C.uuid(),
        ts: nowOnRecordDate().toISOString(), // 表示中の日の分として残す
        type: "diary",
        note: note,
        weight: weight,
        temp: temp,
        by: S.getSettings().by || "",
      };

      var save = Promise.resolve();
      if (state.stagedPhoto) {
        record.photoId = C.uuid();
        save = S.Photos.save(record.photoId, state.stagedPhoto, false);
      }
      save.then(function () {
        S.upsert(record);
        state.stagedPhoto = null;
        $("diary-note").value = "";
        $("diary-weight").value = "";
        $("diary-temp").value = "";
        $("photo-preview").hidden = true;
        $("photo-pick-hint").hidden = false;
        render();
      });
    });
  }

  // ---- マイページ ----

  function bindMypage() {
    $("profile-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var p = S.getProfile();
      p.name = $("p-name").value.trim();
      p.sex = $("p-sex").value;
      p.birth = $("p-birth").value;
      p.breed = $("p-breed").value.trim();
      p.diseases = $("p-diseases").value.trim();
      S.setProfile(p);
      render();
    });

    $("avatar-input").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      resizeImage(file, 400).then(function (dataUrl) {
        var p = S.getProfile();
        p.avatarPhotoId = C.uuid();
        return S.Photos.save(p.avatarPhotoId, dataUrl, false).then(function () {
          S.setProfile(p);
          render();
        });
      }).catch(function () {
        alert("写真を読み込めませんでした");
      });
      e.target.value = "";
    });

    $("consult-btn").addEventListener("click", function () {
      var text = C.buildConsultText(S.getProfile(), S.getRecords());
      var ta = $("consult-text");
      ta.value = text;
      ta.hidden = false;
      $("consult-copy").hidden = false;
    });

    $("consult-copy").addEventListener("click", function () {
      var ta = $("consult-text");
      var done = function () {
        $("consult-copy").textContent = "✅ コピーしました。AIチャットに貼り付けてください";
        setTimeout(function () {
          $("consult-copy").textContent = "📋 コピーする";
        }, 3000);
      };
      var fallback = function () {
        // file:// 直開きなどで clipboard API が使えない場合
        ta.hidden = false;
        ta.select();
        document.execCommand("copy");
        done();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(done).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  // ---- 設定 ----

  function bindSettings() {
    ["setting-by", "setting-gas-url", "setting-gas-token"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        var s = S.getSettings();
        s.by = $("setting-by").value.trim();
        s.gasUrl = $("setting-gas-url").value.trim();
        s.gasToken = $("setting-gas-token").value.trim();
        S.setSettings(s);
        $("by").value = s.by;
      });
    });

    document.querySelectorAll("#food-filter .range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.foodFilter = btn.dataset.genre || "";
        renderSettings();
      });
    });

    $("food-add").addEventListener("click", function () {
      var name = $("food-name").value.trim();
      if (!name) return;
      var foods = S.getFoods().filter(function (f) { return f.name !== name; });
      foods.push({
        name: name,
        genre: $("food-genre").value || "dry",
        amount: Number($("food-amount").value) || 0,
        kcal100: Number($("food-kcal").value) || 0,
      });
      S.setFoods(foods);
      $("food-name").value = "";
      $("food-amount").value = "";
      $("food-kcal").value = "";
      renderSettings();
    });

    $("sync-now").addEventListener("click", function () {
      if (!S.hasSync()) {
        $("sync-status").textContent = "先にApps ScriptのURLを設定してください(docs/setup.md参照)";
        return;
      }
      S.trySync().then(render);
    });

    $("export-btn").addEventListener("click", function () {
      var blob = new Blob([S.exportJSON()], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "kamechan-records-" + C.dayKey(new Date()) + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $("import-btn").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try {
          S.importJSON(text);
          alert("読み込みました");
          render();
        } catch (err) {
          alert("読み込めませんでした: " + err.message);
        }
      });
      e.target.value = "";
    });
  }

  // ---- りれき ----

  function updateHistoryDateLabel() {
    $("history-date-label").textContent = state.historyDate
      ? dayLabel(state.historyDate) + " をえらび中"
      : "日付をえらぶ";
  }

  function bindHistory() {
    // きろく一覧 / アルバム の切り替え
    document.querySelectorAll("#tab-history .range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.historyView = btn.dataset.view;
        render();
      });
    });

    // 透明にした日付inputがタップを拾えない環境向けの保険
    $("history-date").parentElement.addEventListener("click", function (e) {
      var input = $("history-date");
      if (e.target !== input && input.showPicker) {
        try { input.showPicker(); } catch (err) {}
      }
    });
    $("history-date").addEventListener("change", function (e) {
      state.historyDate = e.target.value;
      updateHistoryDateLabel();
      render();
    });
    $("history-clear").addEventListener("click", function () {
      state.historyDate = "";
      $("history-date").value = "";
      updateHistoryDateLabel();
      render();
    });

    // 複数選択して削除
    $("select-mode").addEventListener("click", function () {
      state.selectMode = true;
      state.selected = {};
      render();
    });
    $("select-cancel").addEventListener("click", function () {
      state.selectMode = false;
      state.selected = {};
      render();
    });
    $("select-all").addEventListener("click", function () {
      var allSelected = historyIds.length > 0 && historyIds.every(function (id) {
        return state.selected[id];
      });
      state.selected = {};
      if (!allSelected) {
        historyIds.forEach(function (id) { state.selected[id] = true; });
      }
      render();
    });
    $("select-delete").addEventListener("click", function () {
      var ids = Object.keys(state.selected);
      if (ids.length === 0) return;
      if (!confirm(ids.length + "件の記録を削除しますか?")) return;
      ids.forEach(function (id) { S.remove(id); });
      state.selectMode = false;
      state.selected = {};
      render();
    });
  }

  // ---- 起動 ----

  function init() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });

    document.querySelectorAll("#tab-charts .range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.chartMode = btn.dataset.mode;
        if (state.chartMode === "range" && (!state.chartFrom || !state.chartTo)) {
          // 期間指定をはじめて開いたときは直近30日を出す
          var today = C.dayKey(new Date());
          state.chartTo = today;
          state.chartFrom = C.shiftDay(today, -29);
        }
        document.querySelectorAll("#tab-charts .range-btn").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        render();
      });
    });

    // 期間指定の入力(逆順に選んでも入れ替えて描く)
    [["range-from", "chartFrom"], ["range-to", "chartTo"]].forEach(function (pair) {
      $(pair[0]).addEventListener("change", function (e) {
        if (e.target.value) state[pair[1]] = e.target.value;
        if (state.chartFrom && state.chartTo && state.chartFrom > state.chartTo) {
          var t = state.chartFrom;
          state.chartFrom = state.chartTo;
          state.chartTo = t;
        }
        render();
      });
    });

    $("month-prev").addEventListener("click", function () {
      state.chartMonth = shiftMonth(state.chartMonth, -1);
      render();
    });
    $("month-next").addEventListener("click", function () {
      state.chartMonth = shiftMonth(state.chartMonth, 1);
      render();
    });
    $("chart-month").addEventListener("change", function (e) {
      if (e.target.value) {
        state.chartMonth = e.target.value;
        render();
      }
    });

    // トイレ記録: ワンタップで1回ぶん記録(表示中の日の分として)
    [["toilet-pee", "pee"], ["toilet-poop", "poop"]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function () {
        S.upsert({
          id: C.uuid(),
          ts: nowOnRecordDate().toISOString(),
          type: "toilet",
          label: pair[1],
          amount: 1,
          by: S.getSettings().by || "",
        });
        render();
      });
    });

    S.onSyncChange = function (st) {
      var badge = $("sync-badge");
      badge.hidden = false;
      badge.textContent = st.busy ? "☁️ 同期中…" : st.lastResult;
      $("sync-status").textContent = st.lastResult;
      if (!st.busy) render();
    };

    $("ts").value = nowLocalForInput();
    $("by").value = S.getSettings().by || "";

    S.migrateFoodDefs();
    applyAppearance();
    bindKeyboardWatch();
    bindForm();
    bindRecordDate();
    bindDiary();
    bindMypage();
    bindSettings();
    bindHistory();
    bindAlbum();
    rebuildBowlRows();

    // #charts のようにURLで直接タブを開けるようにする
    var hashTab = location.hash.replace("#", "");
    if (["charts", "history", "mypage", "settings"].indexOf(hashTab) >= 0) {
      switchTab(hashTab);
    } else {
      render();
    }

    // 同期先が設定されていれば起動時に取り込む
    if (S.hasSync()) S.trySync().then(render);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
