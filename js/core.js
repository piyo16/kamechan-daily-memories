/*
 * core.js — 純粋ロジック(UIに依存しない)
 * ブラウザと Node の両方から使えるようにしてあり、Node ではユニットテストに使う。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KameCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TYPES = {
    food: { label: "ごはん", unit: "g", emoji: "🍚" },
    water: { label: "水", unit: "ml", emoji: "💧" },
    snack: { label: "おやつ", unit: "g", emoji: "🍬" },
  };

  // 量を集計する対象(diary/profile などは集計に含めない)
  var AMOUNT_TYPES = ["food", "water", "snack"];

  // ごはんのジャンル(レコードの genre)。genre がない旧レコードは合算のみに入る
  var FOOD_GENRES = {
    dry: { label: "ドライ", emoji: "🍚", totalKey: "foodDry" },
    wet: { label: "ウェット", emoji: "🥫", totalKey: "foodWet" },
  };

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // あげた量と残した量から摂取量を出す。残しが未入力なら全量摂取とみなす。
  function consumed(given, left) {
    var g = Number(given) || 0;
    var l = Number(left) || 0;
    return Math.max(0, round1(g - l));
  }

  // "YYYY-MM-DD" (ローカル日付) を返す
  function dayKey(ts) {
    var d = ts instanceof Date ? ts : new Date(ts);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  // "YYYY-MM-DD" を delta 日ずらした日付キーを返す(月・年またぎもOK)
  function shiftDay(key, delta) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return key;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta);
    return dayKey(d);
  }

  // 同一idは updatedAt が新しい方を採用してマージ(削除トゥームストーンも保持)
  function mergeRecords(a, b) {
    var byId = {};
    [].concat(a || [], b || []).forEach(function (r) {
      if (!r || !r.id) return;
      var cur = byId[r.id];
      if (!cur || String(r.updatedAt || "") > String(cur.updatedAt || "")) {
        byId[r.id] = r;
      }
    });
    return Object.keys(byId)
      .map(function (id) { return byId[id]; })
      .sort(function (x, y) { return String(x.ts) < String(y.ts) ? -1 : 1; });
  }

  function liveRecords(records) {
    return (records || []).filter(function (r) { return !r.deleted; });
  }

  // 日別合計の空の入れ物。foodDry / foodWet は food(合算)の内訳
  function emptyDayTotals() {
    return { food: 0, foodDry: 0, foodWet: 0, water: 0, snack: 0 };
  }

  // 日別合計: { "2026-07-05": { food: 42, foodDry: 30, foodWet: 12, water: 120, snack: 5 }, ... }
  function dailyTotals(records) {
    var out = {};
    liveRecords(records).forEach(function (r) {
      if (AMOUNT_TYPES.indexOf(r.type) < 0) return;
      var k = dayKey(r.ts);
      if (!out[k]) out[k] = emptyDayTotals();
      var amount = Number(r.amount) || 0;
      out[k][r.type] = round1((out[k][r.type] || 0) + amount);
      if (r.type === "food" && FOOD_GENRES[r.genre]) {
        var gk = FOOD_GENRES[r.genre].totalKey;
        out[k][gk] = round1(out[k][gk] + amount);
      }
    });
    return out;
  }

  // 直近 n 日分の [{ day, food, foodDry, foodWet, water, snack }] を古い順で返す(欠損日は0)
  function lastNDays(records, n, today) {
    var totals = dailyTotals(records);
    var base = today ? new Date(today) : new Date();
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      var k = dayKey(d);
      var t = totals[k] || emptyDayTotals();
      out.push({ day: k, food: t.food, foodDry: t.foodDry, foodWet: t.foodWet, water: t.water, snack: t.snack });
    }
    return out;
  }

  // 週の始まり(月曜)の0時を返す
  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  /*
   * 直近 nWeeks 週の週平均(月曜はじまり、新しい週が最後)。
   * 記録がある日だけで平均する(つけ忘れの日で平均が下がらないように)。
   * [{ start: "YYYY-MM-DD", days, food, water }]
   */
  function weeklyAverages(records, nWeeks, today) {
    var totals = dailyTotals(records);
    var base = startOfWeek(today ? new Date(today) : new Date());
    var out = [];
    for (var w = nWeeks - 1; w >= 0; w--) {
      var start = new Date(base);
      start.setDate(start.getDate() - w * 7);
      var days = 0, food = 0, water = 0;
      for (var i = 0; i < 7; i++) {
        var d = new Date(start);
        d.setDate(d.getDate() + i);
        var t = totals[dayKey(d)];
        if (t && (t.food > 0 || t.water > 0 || t.snack > 0)) {
          days++;
          food += t.food;
          water += t.water;
        }
      }
      out.push({
        start: dayKey(start),
        days: days,
        food: days ? round1(food / days) : 0,
        water: days ? round1(water / days) : 0,
      });
    }
    return out;
  }

  // diaryレコードの数値項目(weight/temp)の推移: 日ごとの最新値を古い順で
  function diaryFieldSeries(records, field) {
    var byDay = {};
    liveRecords(records).forEach(function (r) {
      if (r.type !== "diary" || !(Number(r[field]) > 0)) return;
      var k = dayKey(r.ts);
      if (!byDay[k] || String(r.ts) > String(byDay[k].ts)) {
        byDay[k] = { ts: r.ts, value: Number(r[field]) };
      }
    });
    return Object.keys(byDay).sort().map(function (k) {
      return { day: k, value: byDay[k].value };
    });
  }

  function weightSeries(records) { return diaryFieldSeries(records, "weight"); }
  function tempSeries(records) { return diaryFieldSeries(records, "temp"); }

  // "YYYY-MM" の月の日別合計を、1日から月末まで欠損0埋めで返す
  function daysOfMonth(records, ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) return [];
    var year = Number(m[1]), month = Number(m[2]);
    var totals = dailyTotals(records);
    var lastDay = new Date(year, month, 0).getDate();
    var out = [];
    for (var d = 1; d <= lastDay; d++) {
      var k = ym + "-" + (d < 10 ? "0" + d : d);
      var t = totals[k] || emptyDayTotals();
      out.push({ day: k, food: t.food, foodDry: t.foodDry, foodWet: t.foodWet, water: t.water, snack: t.snack });
    }
    return out;
  }

  /*
   * from〜to("YYYY-MM-DD"・両端を含む)の日別合計を欠損0埋めで返す。
   * 形式が不正・from が to より後のときは空配列。長すぎる期間は2年で打ち切る。
   */
  function daysInRange(records, fromKey, toKey) {
    var re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(fromKey) || !re.test(toKey) || fromKey > toKey) return [];
    var totals = dailyTotals(records);
    var out = [];
    for (var k = fromKey; k <= toKey && out.length < 731; k = shiftDay(k, 1)) {
      var t = totals[k] || emptyDayTotals();
      out.push({ day: k, food: t.food, foodDry: t.foodDry, foodWet: t.foodWet, water: t.water, snack: t.snack });
    }
    return out;
  }

  // 写真つきの記録を新しい順で返す(アルバム用): [{ id, photoId, ts, day, note, by }]
  function photoEntries(records) {
    return liveRecords(records)
      .filter(function (r) { return r.photoId && r.type !== "profile" && r.type !== "fooddefs"; })
      .sort(function (a, b) { return String(a.ts) < String(b.ts) ? 1 : -1; })
      .map(function (r) {
        return { id: r.id, photoId: r.photoId, ts: r.ts, day: dayKey(r.ts), note: r.note || "", by: r.by || "" };
      });
  }

  /*
   * "YYYY-MM" の月に重なる週(月曜はじまり)ごとの平均。
   * food/water/snack は記録がある日の平均、weight/temp はその週の記録値の平均。
   * [{ start, days, food, water, snack, weight, temp }]
   */
  function weeklyStatsForMonth(records, ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) return [];
    var year = Number(m[1]), month = Number(m[2]);
    var totals = dailyTotals(records);
    var wSeries = weightSeries(records);
    var tSeries = tempSeries(records);
    var firstWeek = startOfWeek(new Date(year, month - 1, 1));
    var monthEnd = new Date(year, month, 0);
    var out = [];

    for (var ws = new Date(firstWeek); ws <= monthEnd; ws.setDate(ws.getDate() + 7)) {
      var days = 0, food = 0, foodDry = 0, foodWet = 0, water = 0, snack = 0;
      var weekKeys = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
        var k = dayKey(d);
        weekKeys.push(k);
        var t = totals[k];
        if (t && (t.food > 0 || t.water > 0 || t.snack > 0)) {
          days++;
          food += t.food;
          foodDry += t.foodDry;
          foodWet += t.foodWet;
          water += t.water;
          snack += t.snack;
        }
      }
      function avgOf(series) {
        var vals = series.filter(function (p) { return weekKeys.indexOf(p.day) >= 0; })
          .map(function (p) { return p.value; });
        if (!vals.length) return 0;
        return Math.round((vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) * 100) / 100;
      }
      out.push({
        start: dayKey(new Date(ws)),
        days: days,
        food: days ? round1(food / days) : 0,
        foodDry: days ? round1(foodDry / days) : 0,
        foodWet: days ? round1(foodWet / days) : 0,
        water: days ? round1(water / days) : 0,
        snack: days ? round1(snack / days) : 0,
        weight: avgOf(wSeries),
        temp: avgOf(tSeries),
      });
    }
    return out;
  }

  /*
   * 日別カロリー: { "YYYY-MM-DD": kcal }
   * フード登録(foodDefs: [{name, amount, kcal100}])の kcal100(100gあたりのカロリー)と
   * ごはん・おやつ記録の摂取量から計算する。カロリー未登録のフードは含めない。
   * type に "food" / "snack" を渡すとその種類だけ、省略すると合算。
   */
  function dailyKcal(records, foodDefs, type) {
    var per100 = {};
    (foodDefs || []).forEach(function (f) {
      if (f && f.name && Number(f.kcal100) > 0) per100[f.name] = Number(f.kcal100);
    });
    var out = {};
    liveRecords(records).forEach(function (r) {
      if (r.type !== "food" && r.type !== "snack") return;
      if (type && r.type !== type) return;
      var k100 = per100[r.label];
      if (!k100) return;
      var k = dayKey(r.ts);
      out[k] = round1((out[k] || 0) + (Number(r.amount) || 0) * k100 / 100);
    });
    return out;
  }

  // トイレ記録の日別回数: { "YYYY-MM-DD": { pee: 3, poop: 1 } }
  function dailyToiletCounts(records) {
    var out = {};
    liveRecords(records).forEach(function (r) {
      if (r.type !== "toilet") return;
      var k = dayKey(r.ts);
      if (!out[k]) out[k] = { pee: 0, poop: 0 };
      var kind = r.label === "poop" ? "poop" : "pee";
      out[k][kind] += Number(r.amount) || 1;
    });
    return out;
  }

  /*
   * 簡易健康チェック: 直近7日と、その前7日の「記録がある日の平均」を比べる。
   * 医療判断ではなく「変化に気づく」ためのもの。
   * [{ level: "good"|"warning"|"info", message }]
   */
  function healthCheck(records, today) {
    var totals = dailyTotals(records);
    var base = today ? new Date(today) : new Date();

    function avgRange(fromDaysAgo, toDaysAgo) {
      var days = 0, food = 0, water = 0;
      for (var i = fromDaysAgo; i <= toDaysAgo; i++) {
        var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
        var t = totals[dayKey(d)];
        if (t && (t.food > 0 || t.water > 0)) {
          days++;
          food += t.food;
          water += t.water;
        }
      }
      return { days: days, food: days ? food / days : 0, water: days ? water / days : 0 };
    }

    var cur = avgRange(0, 6);
    var prev = avgRange(7, 13);
    var out = [];

    if (cur.days === 0) {
      return [{ level: "info", message: "直近7日の記録がありません。まずは毎日の記録を続けましょう" }];
    }

    if (prev.days >= 3) {
      if (prev.water > 0 && cur.water > prev.water * 1.3) {
        out.push({
          level: "warning",
          message: "飲水量が前の週より約" + Math.round((cur.water / prev.water - 1) * 100) +
            "%増えています。多飲は腎臓病や糖尿病の初期サインのことがあるので、続くようなら受診を検討してください",
        });
      }
      if (prev.water > 0 && cur.water < prev.water * 0.7) {
        out.push({
          level: "warning",
          message: "飲水量が前の週より約" + Math.round((1 - cur.water / prev.water) * 100) +
            "%減っています。脱水に注意して、水飲み場を増やすなど工夫してみてください",
        });
      }
      if (prev.food > 0 && cur.food < prev.food * 0.75) {
        out.push({
          level: "warning",
          message: "食事量が前の週より約" + Math.round((1 - cur.food / prev.food) * 100) +
            "%減っています。食欲低下が2〜3日続くようなら受診を検討してください",
        });
      }
    }

    // 体重: 最新値と約30日前(それ以前で最も近い記録)を比べて±10%
    var ws = weightSeries(records);
    if (ws.length >= 2) {
      var latest = ws[ws.length - 1];
      var cutoff = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 30);
      var refKey = dayKey(cutoff);
      var ref = null;
      for (var i = ws.length - 2; i >= 0; i--) {
        ref = ws[i];
        if (ws[i].day <= refKey) break;
      }
      if (ref && ref.day !== latest.day) {
        var ratio = latest.value / ref.value;
        if (ratio < 0.9) {
          out.push({
            level: "warning",
            message: "体重が " + ref.value + "kg → " + latest.value +
              "kg に減っています。1か月で10%以上の減少は受診をおすすめします",
          });
        } else if (ratio > 1.1) {
          out.push({
            level: "info",
            message: "体重が " + ref.value + "kg → " + latest.value + "kg に増えています。食事量の見直しも検討してみてください",
          });
        }
      }
    }

    // 体温: 最新値が猫の平熱(おおよそ38.0〜39.2℃)から外れていないか
    var ts = tempSeries(records);
    if (ts.length > 0) {
      var latestTemp = ts[ts.length - 1];
      if (latestTemp.value >= 39.5) {
        out.push({
          level: "warning",
          message: "最新の体温が " + latestTemp.value + "℃ と高めです(猫の平熱はおよそ38.0〜39.2℃)。元気や食欲がないようなら受診を検討してください",
        });
      } else if (latestTemp.value < 37.5) {
        out.push({
          level: "warning",
          message: "最新の体温が " + latestTemp.value + "℃ と低めです。測り直しても低い場合は受診を検討してください",
        });
      }
    }

    if (out.length === 0) {
      out.push({ level: "good", message: "直近7日の食事・飲水量に大きな変化はありません" });
    }
    return out;
  }

  // 誕生日("YYYY-MM-DD"。旧データの"YYYY-MM"も可)から「X歳Yか月」を作る
  function ageLabel(birth, today) {
    if (!birth) return "";
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(birth);
    if (!m) return "";
    var base = today ? new Date(today) : new Date();
    var months = (base.getFullYear() - Number(m[1])) * 12 + (base.getMonth() + 1 - Number(m[2]));
    // 日にちまで分かっていて、今月の誕生日がまだ来ていなければ1か月引く
    if (m[3] && base.getDate() < Number(m[3])) months--;
    if (months < 0) return "";
    return Math.floor(months / 12) + "歳" + (months % 12) + "か月";
  }

  // AIに相談するための要約テキストを作る(APIは呼ばない。無料のAIチャットに貼り付けて使う)
  function buildConsultText(profile, records, today) {
    var p = profile || {};
    var days = lastNDays(records, 14, today);
    var weeks = weeklyAverages(records, 4, today);
    var ws = weightSeries(records).slice(-6);
    var checks = healthCheck(records, today);

    var lines = [];
    lines.push("あなたは猫の健康に詳しい獣医師アシスタントです。以下の猫の記録を見て、健康状態で気になる点、様子を見てよい点、動物病院を受診すべき目安を教えてください。");
    lines.push("");
    lines.push("■ 猫のプロフィール");
    lines.push("- 名前: " + (p.name || "(未登録)"));
    if (p.sex) lines.push("- 性別: " + p.sex);
    if (p.birth) lines.push("- 年齢: " + ageLabel(p.birth, today) + " (" + p.birth + "生まれ)");
    if (p.breed) lines.push("- 猫種: " + p.breed);
    if (p.diseases) lines.push("- 病気・通院: " + p.diseases);
    if (ws.length) lines.push("- 体重の推移: " + ws.map(function (w) { return w.day.slice(5) + " " + w.value + "kg"; }).join(", "));
    var temps = tempSeries(records).slice(-6);
    if (temps.length) lines.push("- 体温の推移: " + temps.map(function (t) { return t.day.slice(5) + " " + t.value + "℃"; }).join(", "));
    lines.push("");
    lines.push("■ 直近14日の記録(日付: ごはんg / 水ml / トイレ回数)");
    var toilet = dailyToiletCounts(records);
    days.forEach(function (d) {
      var t = toilet[d.day];
      lines.push("- " + d.day + ": ごはん" + d.food + "g / 水" + d.water + "ml" +
        (d.snack ? " / おやつ" + d.snack + "g" : "") +
        (t ? " / おしっこ" + t.pee + "回・うんち" + t.poop + "回" : ""));
    });
    lines.push("");
    lines.push("■ 週平均(記録がある日の平均)");
    weeks.forEach(function (w) {
      lines.push("- " + w.start + "の週: ごはん" + w.food + "g/日, 水" + w.water + "ml/日 (記録" + w.days + "日)");
    });
    lines.push("");
    lines.push("■ アプリの自動チェック");
    checks.forEach(function (c) { lines.push("- " + c.message); });
    return lines.join("\n");
  }

  return {
    TYPES: TYPES,
    AMOUNT_TYPES: AMOUNT_TYPES,
    FOOD_GENRES: FOOD_GENRES,
    uuid: uuid,
    consumed: consumed,
    dayKey: dayKey,
    shiftDay: shiftDay,
    mergeRecords: mergeRecords,
    liveRecords: liveRecords,
    dailyTotals: dailyTotals,
    lastNDays: lastNDays,
    startOfWeek: startOfWeek,
    weeklyAverages: weeklyAverages,
    weightSeries: weightSeries,
    tempSeries: tempSeries,
    daysOfMonth: daysOfMonth,
    daysInRange: daysInRange,
    photoEntries: photoEntries,
    weeklyStatsForMonth: weeklyStatsForMonth,
    dailyKcal: dailyKcal,
    dailyToiletCounts: dailyToiletCounts,
    healthCheck: healthCheck,
    ageLabel: ageLabel,
    buildConsultText: buildConsultText,
  };
});
