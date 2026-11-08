import { BASE_CARDS_DEF, MOON_CARDS } from '../data/cards.js';

// 廣播／紀錄文字轉換：數值 → emoji、卡牌名（不用【】）金黃粗體、「你」天藍粗體
export const NUM_KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
// 掘墓人可奪取的牌：狼人與掘墓人不可取
export const canSteal = (c) => !!c && c.type !== 'WEREWOLF' && c.type !== 'GRAVEDIGGER';

export const numEmoji = (n) => {
  const v = parseInt(n, 10);
  if (v === 10) return '🔟';
  return String(v).split('').map(d => NUM_KEYCAPS[parseInt(d, 10)]).join('');
};
export const KNOWN_CARD_TITLES = new Set([...BASE_CARDS_DEF.map(c => c.title), '狼人', ...MOON_CARDS.map(m => m.title)]);
