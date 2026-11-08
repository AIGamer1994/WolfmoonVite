

// 29 張普通角色牌範本 + 1張特殊狼人牌
export const BASE_CARDS_DEF = [
  { title: '刺客', desc: '選擇一位玩家，猜其手牌數值 0–10；您有2次猜測機會。猜中使其出局。', value: 0, icon: 'fa-user-secret', category: '數值 0', totalCount: 1, type: 'ASSASSIN' },
  { title: '乞丐之王', desc: '當牌庫耗盡時，若您手握此牌且有玩家手牌為8或9，您獨享勝利。', value: 0, icon: 'fa-crown', category: '數值 0', totalCount: 1, type: 'PASSIVE' },
  { title: '村民', desc: '選擇一位玩家，猜其手牌數值 0–10；猜中使其出局。', value: 1, icon: 'fa-person', category: '數值 1', totalCount: 4, type: 'VILLAGER' },
  { title: '醉漢', desc: '收集所有存活玩家手牌並秘密檢視，洗勻後隨機發回每人1張。', value: 1, icon: 'fa-wine-bottle', category: '數值 1', totalCount: 1, type: 'DRUNKARD' },
  { title: '僕人', desc: '打出後可立即棄掉面前的僕人，立刻進行額外回合；亦可留到之後回合結束再使用。', value: 1, icon: 'fa-bell-concierge', category: '數值 1', totalCount: 1, type: 'SERVANT' },
  { title: '先知', desc: '秘密檢視一位對手的手牌。', value: 2, icon: 'fa-eye', category: '數值 2', totalCount: 1, type: 'SEER' },
  { title: '稅務官', desc: '指定一位玩家，若其手牌為 0 或 1，該玩家出局。', value: 2, icon: 'fa-coins', category: '數值 2', totalCount: 1, type: 'TAX_COLLECTOR' },
  { title: '審判官', desc: '指定一位玩家，若其手牌為 9 或 10，該玩家出局。', value: 2, icon: 'fa-gavel', category: '數值 2', totalCount: 1, type: 'INQUISITOR' },
  { title: '吸血鬼', desc: '打出時，若您面前已有至少 2 張數值 7 以上的牌，立刻獲勝。', value: 2, icon: 'fa-droplet', category: '數值 2', totalCount: 1, type: 'VAMPIRE' },
  { title: '酒保', desc: '秘密比較自己與一位對手的手牌數值；較小者出局。', value: 3, icon: 'fa-martini-glass', category: '數值 3', totalCount: 1, type: 'BARKEEPER' },
  { title: '小女孩', desc: '秘密比較自己與一位對手的手牌數值；較大者出局。', value: 3, icon: 'fa-child', category: '數值 3', totalCount: 1, type: 'GIRL' },
  { title: '商人', desc: '牌庫耗盡時，若您面前有商人，手牌結算數值 +2。', value: 3, icon: 'fa-store', category: '數值 3', totalCount: 1, type: 'PASSIVE' },
  { title: '守夜人', desc: '拿起中央3張牌，從4張中留1張，其餘3張放回中央。', value: 3, icon: 'fa-binoculars', category: '數值 3', totalCount: 1, type: 'NIGHT_WATCHMAN' },
  { title: '保鏢', desc: '直到您下個回合開始前不受其他玩家牌效影響。', value: 4, icon: 'fa-shield-halved', category: '數值 4', totalCount: 2, type: 'BODYGUARD' },
  { title: '女巫', desc: '指定一位出局玩家復活抽牌；若該玩家獲勝，您也共同獲勝。', value: 4, icon: 'fa-hat-wizard', category: '數值 4', totalCount: 1, type: 'WITCH' },
  { title: '科學怪人', desc: '牌庫耗盡時若手握此牌，最終數值為面前最小與最大牌的總和。', value: 4, icon: 'fa-bolt', category: '數值 4', totalCount: 1, type: 'PASSIVE' },
  { title: '叛徒', desc: '第3張月亮翻開且狼人獲勝時，若您手握叛徒，您也獲勝。', value: 5, icon: 'fa-mask', category: '數值 5', totalCount: 1, type: 'PASSIVE' },
  { title: '賞金獵人', desc: '指定玩家公開手牌並重抽；若重抽到市長或狼人，該玩家出局。', value: 5, icon: 'fa-crosshairs', category: '數值 5', totalCount: 1, type: 'BOUNTY_HUNTER' },
  { title: '掘墓人', desc: '從一位玩家面前取一張牌（狼人、掘墓人除外）加入手牌，再選1張打出並結算。', value: 6, icon: 'fa-skull', category: '數值 6', totalCount: 1, type: 'GRAVEDIGGER' },
  { title: '扒手', desc: '指定兩位對手，互換手牌。', value: 6, icon: 'fa-people-arrows-left-right', category: '數值 6', totalCount: 1, type: 'PICKPOCKET' },
  { title: '間諜', desc: '若他人猜測您的手牌失敗，可打出間諜使猜測者出局並接手其手牌。', value: 7, icon: 'fa-user-secret', category: '數值 7', totalCount: 1, type: 'SPY' },
  { title: '小偷', desc: '與一位對手交換手牌，然後立刻進行額外回合。', value: 7, icon: 'fa-mask', category: '數值 7', totalCount: 1, type: 'THIEF' },
  { title: '陰謀家', desc: '手握此牌被對手牌效淘汰時，該對手也出局。', value: 8, icon: 'fa-chess-knight', category: '數值 8', totalCount: 1, type: 'PASSIVE' },
  { title: '煉金術士', desc: '因牌效出局時，可棄掉面前的煉金術士並抽牌復活（含自己打出市長／狼人）。', value: 8, icon: 'fa-flask', category: '數值 8', totalCount: 1, type: 'PASSIVE' },
  { title: '市長', desc: '打出時立刻出局。', value: 9, icon: 'fa-user-tie', category: '數值 9', totalCount: 1, type: 'MAYOR' },
];

export const WEREWOLF_CARD = { title: '狼人', desc: '打出時立刻出局；若第三張月亮翻開時手握狼人，立刻獲勝。', value: 10, icon: 'fa-paw', category: '數值 10', totalCount: 1, type: 'WEREWOLF' };

export const MOON_CARDS = [
  { title: '孤狼月亮牌', isMoon: true, level: 1, desc: '第1張月亮牌。翻開後面朝上放在桌面，翻開者繼續抽下一張牌。' },
  { title: '嘯狼月亮牌', isMoon: true, level: 2, desc: '第2張月亮牌。翻開後面朝上放在桌面，翻開者繼續抽下一張牌。' },
  { title: '狼人月亮牌', isMoon: true, level: 3, desc: '第3張月亮牌。手握狼人者立刻獲勝！' },
];
