

export const FX_KIND = {
  '村民': 'guess', '刺客': 'guess', '稅務官': 'ask', '審判官': 'ask', '先知': 'peek',
  '酒保': 'compare', '小女孩': 'compare', '小偷': 'swap', '扒手': 'swap', '醉漢': 'drunk',
  '守夜人': 'watch', '保鏢': 'shield', '賞金獵人': 'bounty', '掘墓人': 'grave', '女巫': 'witch',
  '市長': 'selfout', '狼人': 'selfout',
};
export const FX_DURATION = { moon: 3200, guess: 2700, ask: 2500, peek: 2800, compare: 7000, swap: 2700, drunk: 4000, watch: 2700, takeone: 2700, shield: 2100, bounty: 2800, grave: 3600, witch: 2500, selfout: 2100, plain: 2200, none: 1600, place: 3200, servant: 3200, alchemist: 3600, wolfbite: 4300, vampire: 6500, match: 7200 };
// 被動牌打出時「沒有任何效果（原因）」的原因（動態廣播、行動紀錄、置於面前動畫共用）
export const PASSIVE_WHY = {
  '乞丐之王': '結算時才發動',
  '間諜': '手握此牌被猜錯時才發動',
  '科學怪人': '手握此牌結算時才發動',
  '商人': '結算時才發動',
  '煉金術士': '被淘汰才會發動',
  '陰謀家': '手握此牌被淘汰時才會發動',
  '叛徒': '手握此牌狼人獲勝時才發動',
};
// 動畫播完後最後一格多停留的時間：無任何效果（置於面前）停 2 秒，其他動畫停 1 秒
export const fxHold = (f) => (f && f.kind === 'place' ? 2000 : (f && f.kind === 'moon' ? 800 : 1000));
export const FX_SHOW_NONE = false; // 「無效果」小標籤動畫：目前關閉（程式保留，改 true 即恢復）
export const FX_TOTAL = 4000; // 效果動畫總長（毫秒）；內部各步驟依 baseDur 等比放慢
export const FX_TOTAL_BY = { compare: 7000, grave: 4800, peek: 3600, place: 4000, servant: 4000, alchemist: 4200, drunk: 5000, wolfbite: 4300, vampire: 6500, match: 7200 }; // 個別動畫的總長（沒列出的用 FX_TOTAL）
export const FX_STAMP_TEXT = { out: '淘汰', fail: '✘ 失敗', nofx: '✘ 無效', revive: '復活', spy: '間諜反殺', tie: '平手' };
export const FX_STAMP_CLS = {
  out: 'text-rose-400 border-rose-400', fail: 'text-slate-200 border-slate-400', nofx: 'text-slate-300 border-slate-500',
  ok: 'text-amber-300 border-amber-400', revive: 'text-emerald-300 border-emerald-400', tie: 'text-sky-300 border-sky-400',
  spy: 'text-fuchsia-300 border-fuchsia-400',
};
