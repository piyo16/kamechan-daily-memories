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
    chartMonth: new Date().toISOString().slice(0, 7), // グラフ表示中の月 "YYYY-MM"
    chartMode: "week", // "week" | "day"
    historyDate: "", // りれきの日付フィルタ("" = 全部)
    stagedPhoto: null, // 「今日のかめ」で選択中の写真dataURL
  };

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

  function nowLocalForInput() {
    var d = new Date();
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

  function render() {
    var records = C.liveRecords(S.getRecords());
    if (state.tab === "record") renderToday(records);
    if (state.tab === "charts") renderCharts(records);
    if (state.tab === "history") renderHistory(records);
    if (state.tab === "mypage") renderMypage(records);
    if (state.tab === "settings") renderSettings();
  }

  function recordItem(r) {
    var li = document.createElement("li");
    li.className = "record-item";

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
        "<div>" + (r.note ? escapeHtml(r.note) : "今日のかめ") +
        (Number(r.weight) > 0 ? ' <span class="record-meta">体重 ' + r.weight + "kg</span>" : "") +
        (Number(r.temp) > 0 ? ' <span class="record-meta">体温 ' + r.temp + "℃</span>" : "") +
        "</div>" +
        '<div class="record-meta">' + escapeHtml(meta) + "</div>";
      li.innerHTML = '<span class="record-emoji">📷</span>';
      li.appendChild(main);
      if (r.photoId) {
        var img = document.createElement("img");
        img.className = "record-photo";
        img.alt = "今日のかめの写真";
        img.hidden = true;
        main.appendChild(img);
        loadPhotoInto(img, r.photoId);
      }
    } else {
      var t = C.TYPES[r.type] || C.TYPES.food;
      var parts = [timeLabel(r.ts), r.label, r.note, r.by].filter(Boolean).join(" · ");
      main.innerHTML =
        '<div><span class="record-amount">' + r.amount + " " + t.unit + "</span>" +
        ' <span class="record-meta">' + t.label + "</span></div>" +
        '<div class="record-meta">' + escapeHtml(parts) + "</div>";
      li.innerHTML = '<span class="record-emoji">' + t.emoji + "</span>";
      li.appendChild(main);
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
    return records.filter(function (r) { return r.type !== "profile"; });
  }

  function renderToday(records) {
    var todayKey = C.dayKey(new Date());
    var todays = listable(records).filter(function (r) { return C.dayKey(r.ts) === todayKey; });

    var totals = C.dailyTotals(todays)[todayKey] || { food: 0, water: 0, snack: 0 };
    $("today-food").textContent = totals.food;
    $("today-water").textContent = totals.water;

    var toilet = C.dailyToiletCounts(records)[todayKey] || { pee: 0, poop: 0 };
    $("toilet-pee-count").textContent = toilet.pee;
    $("toilet-poop-count").textContent = toilet.poop;

    renderFoodDatalist();

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
    // 未来の日・週は0として描かない
    var weeks = C.weeklyStatsForMonth(records, ym).filter(function (w) {
      return w.start <= todayKey;
    });
    var s = {};

    if (state.chartMode === "day") {
      var days = C.daysOfMonth(records, ym).filter(function (d) {
        return d.day <= todayKey;
      });
      s.food = days.map(function (d) { return { day: d.day, value: d.food }; });
      s.water = days.map(function (d) { return { day: d.day, value: d.water }; });
      s.snack = days.map(function (d) { return { day: d.day, value: d.snack }; });
      s.weight = C.weightSeries(records).filter(function (p) { return p.day.slice(0, 7) === ym; });
      s.temp = C.tempSeries(records).filter(function (p) { return p.day.slice(0, 7) === ym; });
    } else {
      s.food = weeks.map(function (w) { return { day: w.start, value: w.food }; });
      s.water = weeks.map(function (w) { return { day: w.start, value: w.water }; });
      s.snack = weeks.map(function (w) { return { day: w.start, value: w.snack }; });
      s.weight = weeks.filter(function (w) { return w.weight > 0; })
        .map(function (w) { return { day: w.start, value: w.weight }; });
      s.temp = weeks.filter(function (w) { return w.temp > 0; })
        .map(function (w) { return { day: w.start, value: w.temp }; });
    }

    var perDay = state.chartMode === "day" ? " / 日" : " / 日の週平均";
    KameChart.renderTrend($("chart-food"), {
      data: s.food, unit: "g", color: "--series-food", title: "ごはん" + perDay,
    });
    KameChart.renderTrend($("chart-water"), {
      data: s.water, unit: "ml", color: "--series-water", title: "水" + perDay,
    });

    var hasSnack = s.snack.some(function (d) { return d.value > 0; });
    $("snack-card").hidden = !hasSnack;
    if (hasSnack) {
      KameChart.renderTrend($("chart-snack"), {
        data: s.snack, unit: "g", color: "--series-snack", title: "おやつ" + perDay,
      });
    }

    $("weight-card").hidden = s.weight.length === 0;
    if (s.weight.length > 0) {
      KameChart.renderTrend($("chart-weight"), {
        data: s.weight, unit: "kg", color: "--series-weight", title: "体重の推移",
        zeroBase: false, // 0起点だと数百gの増減が見えないため
      });
    }

    $("temp-card").hidden = s.temp.length === 0;
    if (s.temp.length > 0) {
      KameChart.renderTrend($("chart-temp"), {
        data: s.temp, unit: "℃", color: "--series-temp", title: "体温の推移",
        zeroBase: false, // 平熱まわりの小さな変化を見るため
      });
    }

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

  function renderHistory(records) {
    var box = $("history-list-box");
    box.innerHTML = "";
    $("history-clear").hidden = !state.historyDate;

    var target = listable(records);
    if (state.historyDate) {
      target = target.filter(function (r) { return C.dayKey(r.ts) === state.historyDate; });
      if (target.length === 0) {
        box.innerHTML = '<p class="empty-note">' + dayLabel(state.historyDate) + " の記録はありません</p>";
        return;
      }
    }
    if (target.length === 0) {
      box.innerHTML = '<p class="empty-note">記録がたまると、ここで振り返れます</p>';
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
        .forEach(function (r) { ul.appendChild(recordItem(r)); });
      box.appendChild(ul);
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
    $("p-birth").value = p.birth || "";
    $("p-breed").value = p.breed || "";
    $("p-diseases").value = p.diseases || "";
  }

  function renderSettings() {
    var s = S.getSettings();
    $("setting-by").value = s.by || "";
    $("setting-gas-url").value = s.gasUrl || "";
    $("setting-gas-token").value = s.gasToken || "";
    $("record-count").textContent = C.liveRecords(S.getRecords()).length;

    var ul = $("food-defs");
    ul.innerHTML = "";
    if (s.foods.length === 0) {
      ul.innerHTML = '<p class="empty-note">まだ登録がありません</p>';
    }
    s.foods.forEach(function (f, idx) {
      var li = document.createElement("li");
      li.className = "food-def-item";
      li.innerHTML =
        '<span class="food-def-name">' + escapeHtml(f.name) + "</span>" +
        '<span class="food-def-amount">' + (f.amount ? f.amount + " g" : "") + "</span>";
      var del = document.createElement("button");
      del.className = "delete-btn";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        s.foods.splice(idx, 1);
        S.setSettings(s);
        renderSettings();
        renderFoodDatalist();
      });
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function renderFoodDatalist() {
    var dl = $("food-list");
    dl.innerHTML = "";
    S.getSettings().foods.forEach(function (f) {
      var opt = document.createElement("option");
      opt.value = f.name;
      dl.appendChild(opt);
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
      var meta = document.createElement("div");
      meta.className = "bowl-row-meta";
      meta.textContent = "✔ " + [timeLabel(record.ts), record.by, record.note]
        .filter(Boolean).join(" · ");
      item.appendChild(meta);
    }

    var row = document.createElement("div");
    row.className = "bowl-row";
    row.innerHTML =
      '<label class="bowl-name">' + (isFood ? "フード名" : "場所(任意)") +
      '<input type="text" class="in-name" ' + (isFood ? 'list="food-list"' : "") +
      ' placeholder="' + (isFood ? "カリカリ" : "リビング") + '"></label>' +
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
      var def = S.getSettings().foods.find(function (f) { return f.name === e.target.value; });
      var givenInput = row.querySelector(".in-given");
      if (def && def.amount && !givenInput.value) {
        givenInput.value = def.amount;
        updateTotalPreview();
      }
    });
    row.querySelector(".in-given").addEventListener("input", updateTotalPreview);
    row.querySelector(".in-left").addEventListener("input", updateTotalPreview);

    item.appendChild(row);
    $("bowl-rows").appendChild(item);
  }

  // 今日の保存済み記録(選択中の種類)を行として並べる
  function rebuildBowlRows(records) {
    $("bowl-rows").innerHTML = "";
    var todayKey = C.dayKey(new Date());
    var saved = C.liveRecords(records || S.getRecords())
      .filter(function (r) { return r.type === state.type && C.dayKey(r.ts) === todayKey; })
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

    var p = $("consumed-preview");
    if (amounts.length === 0) {
      p.hidden = true;
      return;
    }
    var total = Math.round(amounts.reduce(function (a, b) { return a + b; }, 0) * 10) / 10;
    p.hidden = false;
    p.textContent = "今日の" + C.TYPES[state.type].label + " 合計 " + total + " " + unit +
      (amounts.length > 1 ? "(" + amounts.join(" + ") + ")" : "");
  }

  function bindForm() {
    document.querySelectorAll(".type-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.type === btn.dataset.type) return;
        if (isBowlAreaDirty() && !confirm("保存していない入力があります。切り替えますか?")) return;
        state.type = btn.dataset.type;
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
        ts: new Date().toISOString(),
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

    $("food-add").addEventListener("click", function () {
      var name = $("food-name").value.trim();
      if (!name) return;
      var s = S.getSettings();
      s.foods = s.foods.filter(function (f) { return f.name !== name; });
      s.foods.push({ name: name, amount: Number($("food-amount").value) || 0 });
      S.setSettings(s);
      $("food-name").value = "";
      $("food-amount").value = "";
      renderSettings();
      renderFoodDatalist();
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

  function bindHistory() {
    $("history-date").addEventListener("change", function (e) {
      state.historyDate = e.target.value;
      render();
    });
    $("history-clear").addEventListener("click", function () {
      state.historyDate = "";
      $("history-date").value = "";
      render();
    });
  }

  // ---- 起動 ----

  function init() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });

    document.querySelectorAll(".range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.chartMode = btn.dataset.mode;
        document.querySelectorAll(".range-btn").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
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

    // トイレ記録: ワンタップで1回ぶん記録
    [["toilet-pee", "pee"], ["toilet-poop", "poop"]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function () {
        S.upsert({
          id: C.uuid(),
          ts: new Date().toISOString(),
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

    bindForm();
    bindDiary();
    bindMypage();
    bindSettings();
    bindHistory();
    renderFoodDatalist();
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
