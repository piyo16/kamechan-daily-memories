/* node test/core.test.js で実行する簡易テスト */
const assert = require("assert");
const C = require("../js/core.js");

// consumed: あげた量 - 残した量
assert.strictEqual(C.consumed(50, 10), 40);
assert.strictEqual(C.consumed(50, ""), 50);
assert.strictEqual(C.consumed(50, 60), 0); // マイナスにはならない
assert.strictEqual(C.consumed("30.5", "0.2"), 30.3); // 小数と文字列入力

// dayKey: ローカル日付
assert.strictEqual(C.dayKey(new Date(2026, 6, 5, 23, 59)), "2026-07-05");
assert.strictEqual(C.dayKey(new Date(2026, 0, 1, 0, 0)), "2026-01-01");

// shiftDay: 日付キーを日単位でずらす(月・年またぎ)
assert.strictEqual(C.shiftDay("2026-07-13", -1), "2026-07-12");
assert.strictEqual(C.shiftDay("2026-07-01", -1), "2026-06-30");
assert.strictEqual(C.shiftDay("2026-01-01", -1), "2025-12-31");
assert.strictEqual(C.shiftDay("2026-02-28", 1), "2026-03-01");
assert.strictEqual(C.shiftDay("2026-07-12", 1), "2026-07-13");
assert.strictEqual(C.shiftDay("2026-07-12", 0), "2026-07-12");
assert.strictEqual(C.shiftDay("bad", 1), "bad"); // 不正な形式はそのまま返す

// mergeRecords: 同一idは updatedAt が新しい方が勝つ
const older = { id: "a", ts: "2026-07-01T10:00:00Z", type: "food", amount: 10, updatedAt: "2026-07-01T10:00:00Z" };
const newer = { id: "a", ts: "2026-07-01T10:00:00Z", type: "food", amount: 20, updatedAt: "2026-07-02T10:00:00Z" };
const other = { id: "b", ts: "2026-07-02T09:00:00Z", type: "water", amount: 30, updatedAt: "2026-07-02T09:00:00Z" };

let merged = C.mergeRecords([older, other], [newer]);
assert.strictEqual(merged.length, 2);
assert.strictEqual(merged.find((r) => r.id === "a").amount, 20);

// 逆順でも同じ結果(可換)
merged = C.mergeRecords([newer], [older, other]);
assert.strictEqual(merged.find((r) => r.id === "a").amount, 20);

// 削除トゥームストーンは liveRecords で除外される
const deleted = { ...newer, deleted: true, updatedAt: "2026-07-03T00:00:00Z" };
merged = C.mergeRecords([older, other], [deleted]);
assert.strictEqual(C.liveRecords(merged).length, 1);

// dailyTotals: 種類別に日毎へ集計、削除は除外
const recs = [
  { id: "1", ts: "2026-07-05T08:00:00", type: "food", amount: 30, updatedAt: "1" },
  { id: "2", ts: "2026-07-05T19:00:00", type: "food", amount: 25.5, updatedAt: "1" },
  { id: "3", ts: "2026-07-05T12:00:00", type: "water", amount: 60, updatedAt: "1" },
  { id: "4", ts: "2026-07-04T12:00:00", type: "water", amount: 80, updatedAt: "1" },
  { id: "5", ts: "2026-07-05T13:00:00", type: "food", amount: 999, updatedAt: "1", deleted: true },
];
const totals = C.dailyTotals(recs);
assert.strictEqual(totals["2026-07-05"].food, 55.5);
assert.strictEqual(totals["2026-07-05"].water, 60);
assert.strictEqual(totals["2026-07-04"].water, 80);

// lastNDays: 欠損日は0で埋まり、古い順に並ぶ
const days = C.lastNDays(recs, 3, new Date(2026, 6, 5));
assert.strictEqual(days.length, 3);
assert.deepStrictEqual(days.map((d) => d.day), ["2026-07-03", "2026-07-04", "2026-07-05"]);
assert.strictEqual(days[0].food, 0);
assert.strictEqual(days[1].water, 80);
assert.strictEqual(days[2].food, 55.5);

// dailyTotals: diary/profile は集計に入らない
const withDiary = recs.concat([
  { id: "d1", ts: "2026-07-05T21:00:00", type: "diary", note: "元気", weight: 4.2, updatedAt: "1" },
  { id: "profile", ts: "2000-01-01T00:00:00", type: "profile", note: "{}", updatedAt: "1" },
]);
assert.strictEqual(C.dailyTotals(withDiary)["2026-07-05"].food, 55.5);
assert.strictEqual(C.dailyTotals(withDiary)["2000-01-01"], undefined);

// weightSeries: diaryのweightから日ごとの最新値を古い順で
const weights = [
  { id: "w1", ts: "2026-07-01T09:00:00", type: "diary", weight: 4.0, updatedAt: "1" },
  { id: "w2", ts: "2026-07-01T21:00:00", type: "diary", weight: 4.1, updatedAt: "1" },
  { id: "w3", ts: "2026-07-03T09:00:00", type: "diary", weight: 4.3, updatedAt: "1" },
  { id: "w4", ts: "2026-07-02T09:00:00", type: "diary", note: "体重なし", updatedAt: "1" },
];
assert.deepStrictEqual(C.weightSeries(weights), [
  { day: "2026-07-01", value: 4.1 },
  { day: "2026-07-03", value: 4.3 },
]);

// startOfWeek: 月曜はじまり
assert.strictEqual(C.dayKey(C.startOfWeek(new Date(2026, 6, 5))), "2026-06-29"); // 2026-07-05は日曜
assert.strictEqual(C.dayKey(C.startOfWeek(new Date(2026, 5, 29))), "2026-06-29"); // 月曜はそのまま

// weeklyAverages: 記録がある日だけで平均する
const weekRecs = [
  { id: "a1", ts: "2026-06-29T08:00:00", type: "food", amount: 40, updatedAt: "1" },
  { id: "a2", ts: "2026-06-30T08:00:00", type: "food", amount: 60, updatedAt: "1" },
  { id: "a3", ts: "2026-06-30T08:30:00", type: "water", amount: 80, updatedAt: "1" },
  { id: "a4", ts: "2026-06-22T08:00:00", type: "food", amount: 30, updatedAt: "1" }, // 前の週
];
const weeks = C.weeklyAverages(weekRecs, 2, new Date(2026, 6, 5));
assert.strictEqual(weeks.length, 2);
assert.strictEqual(weeks[0].start, "2026-06-22");
assert.strictEqual(weeks[0].food, 30);
assert.strictEqual(weeks[1].start, "2026-06-29");
assert.strictEqual(weeks[1].days, 2);
assert.strictEqual(weeks[1].food, 50);   // (40+60)/2
assert.strictEqual(weeks[1].water, 40);  // (0+80)/2

// healthCheck: 飲水量が30%以上増えたら warning
function mkWater(id, daysAgo, ml) {
  const d = new Date(2026, 6, 5);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12);
  return { id, ts: d.toISOString(), type: "water", amount: ml, updatedAt: "1" };
}
let hc = [];
for (let i = 0; i < 7; i++) hc.push(mkWater("cur" + i, i, 100));
for (let i = 7; i < 14; i++) hc.push(mkWater("prev" + i, i, 60));
let checks = C.healthCheck(hc, new Date(2026, 6, 5));
assert.ok(checks.some((c) => c.level === "warning" && c.message.includes("増えて")), "多飲がwarningになる");

// 変化がなければ good
hc = [];
for (let i = 0; i < 14; i++) hc.push(mkWater("s" + i, i, 100));
checks = C.healthCheck(hc, new Date(2026, 6, 5));
assert.strictEqual(checks.length, 1);
assert.strictEqual(checks[0].level, "good");

// 記録ゼロなら info
checks = C.healthCheck([], new Date(2026, 6, 5));
assert.strictEqual(checks[0].level, "info");

// ageLabel
assert.strictEqual(C.ageLabel("2020-03", new Date(2026, 6, 5)), "6歳4か月");
assert.strictEqual(C.ageLabel("", new Date()), "");

// buildConsultText: プロフィールと記録が入る
const consult = C.buildConsultText(
  { name: "かめ", sex: "メス", birth: "2020-03", breed: "雑種" },
  hc,
  new Date(2026, 6, 5)
);
assert.ok(consult.includes("かめ"));
assert.ok(consult.includes("6歳4か月"));
assert.ok(consult.includes("直近14日の記録"));
assert.ok(consult.includes("週平均"));

// tempSeries: diaryのtempから
const tempRecs = [
  { id: "t1", ts: "2026-07-01T09:00:00", type: "diary", temp: 38.5, updatedAt: "1" },
  { id: "t2", ts: "2026-07-03T09:00:00", type: "diary", temp: 39.0, updatedAt: "1" },
];
assert.deepStrictEqual(C.tempSeries(tempRecs), [
  { day: "2026-07-01", value: 38.5 },
  { day: "2026-07-03", value: 39.0 },
]);

// healthCheck: 高体温は warning
let tempChecks = C.healthCheck(
  hc.concat([{ id: "t3", ts: "2026-07-05T09:00:00", type: "diary", temp: 39.8, updatedAt: "1" }]),
  new Date(2026, 6, 5)
);
assert.ok(tempChecks.some((c) => c.level === "warning" && c.message.includes("高め")));

// daysOfMonth: 月の全日が0埋めで返る
const monthDays = C.daysOfMonth(recs, "2026-07");
assert.strictEqual(monthDays.length, 31);
assert.strictEqual(monthDays[0].day, "2026-07-01");
assert.strictEqual(monthDays[4].food, 55.5); // 7/5
assert.strictEqual(monthDays[3].water, 80);  // 7/4
assert.strictEqual(monthDays[30].food, 0);   // 7/31 記録なし
assert.deepStrictEqual(C.daysOfMonth(recs, "2026-02").length, 28);
assert.deepStrictEqual(C.daysOfMonth(recs, "bad"), []);

// weeklyStatsForMonth: 月に重なる週ごとの平均(体重・体温も)
const julyRecs = [
  { id: "j1", ts: "2026-07-01T08:00:00", type: "food", amount: 40, updatedAt: "1" },
  { id: "j2", ts: "2026-07-02T08:00:00", type: "food", amount: 60, updatedAt: "1" },
  { id: "j3", ts: "2026-07-02T09:00:00", type: "snack", amount: 10, updatedAt: "1" },
  { id: "j4", ts: "2026-07-01T20:00:00", type: "diary", weight: 4.2, temp: 38.4, updatedAt: "1" },
];
const julyWeeks = C.weeklyStatsForMonth(julyRecs, "2026-07");
// 2026-07-01は水曜 → その週は6/29はじまり。7月は6/29〜7/27の5週にかかる
assert.strictEqual(julyWeeks.length, 5);
assert.strictEqual(julyWeeks[0].start, "2026-06-29");
assert.strictEqual(julyWeeks[0].days, 2);
assert.strictEqual(julyWeeks[0].food, 50);   // (40+60)/2
assert.strictEqual(julyWeeks[0].snack, 5);   // (0+10)/2
assert.strictEqual(julyWeeks[0].weight, 4.2);
assert.strictEqual(julyWeeks[0].temp, 38.4);
assert.strictEqual(julyWeeks[1].weight, 0);  // 翌週は記録なし

// dailyToiletCounts
const toiletRecs = [
  { id: "p1", ts: "2026-07-05T08:00:00", type: "toilet", label: "pee", amount: 1, updatedAt: "1" },
  { id: "p2", ts: "2026-07-05T15:00:00", type: "toilet", label: "pee", amount: 1, updatedAt: "1" },
  { id: "p3", ts: "2026-07-05T20:00:00", type: "toilet", label: "poop", amount: 1, updatedAt: "1" },
  { id: "p4", ts: "2026-07-04T09:00:00", type: "toilet", label: "pee", amount: 1, updatedAt: "1", deleted: true },
];
const tc = C.dailyToiletCounts(toiletRecs);
assert.deepStrictEqual(tc["2026-07-05"], { pee: 2, poop: 1 });
assert.strictEqual(tc["2026-07-04"], undefined);
// トイレは量の集計に入らない
assert.strictEqual(C.dailyTotals(toiletRecs)["2026-07-05"], undefined);

// dailyKcal: フード登録のkcal/100gと摂取量からカロリーを日別集計
const kcalDefs = [
  { name: "カリカリ", amount: 25, kcal100: 360 },
  { name: "ちゅ〜る", amount: 14, kcal100: 50 },
  { name: "カロリー未登録", amount: 20 },
];
const kcalRecs = [
  { id: "k1", ts: "2026-07-05T08:00:00", type: "food", label: "カリカリ", amount: 50, updatedAt: "1" },
  { id: "k2", ts: "2026-07-05T15:00:00", type: "snack", label: "ちゅ〜る", amount: 14, updatedAt: "1" },
  { id: "k3", ts: "2026-07-05T18:00:00", type: "food", label: "カロリー未登録", amount: 30, updatedAt: "1" },
  { id: "k4", ts: "2026-07-05T19:00:00", type: "water", label: "カリカリ", amount: 60, updatedAt: "1" },
  { id: "k5", ts: "2026-07-04T08:00:00", type: "food", label: "カリカリ", amount: 25, updatedAt: "1" },
  { id: "k6", ts: "2026-07-03T08:00:00", type: "food", label: "カリカリ", amount: 999, updatedAt: "1", deleted: true },
];
const kcal = C.dailyKcal(kcalRecs, kcalDefs);
assert.strictEqual(kcal["2026-07-05"], 187); // 50g*3.6 + 14g*0.5 = 180+7
assert.strictEqual(kcal["2026-07-04"], 90);  // 25g*3.6
assert.strictEqual(kcal["2026-07-03"], undefined); // 削除済みは除外
assert.deepStrictEqual(C.dailyKcal(kcalRecs, []), {}); // 登録なしなら空

console.log("all tests passed ✔");
