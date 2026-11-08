import React from 'react';
import { KNOWN_CARD_TITLES, numEmoji } from '../utils/cards.js';

export function RichLog({ text, nameClass = 'text-amber-300', localPlayerName = null }) {
  if (text === undefined || text === null) return null;
  const rawText = String(text);
  const str = localPlayerName && localPlayerName !== '你'
    ? rawText.split(localPlayerName).join('你')
    : rawText;
  const out = [];
  const re = /\((\d+)\)【([^】]+)】|\((\d+)\)|【([^】]+)】|你/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out.push(str.slice(last, m.index));
    if (m[1] !== undefined) {
      if (KNOWN_CARD_TITLES.has(m[2])) out.push(<span key={k++}>{numEmoji(m[1])}<b className={`font-black ml-0.5 ${nameClass}`}>{m[2]}</b></span>);
      else out.push(m[0]);
    } else if (m[3] !== undefined) {
      out.push(numEmoji(m[3]));
    } else if (m[4] !== undefined) {
      if (KNOWN_CARD_TITLES.has(m[4])) out.push(<b key={k++} className={`font-black ${nameClass}`}>{m[4]}</b>);
      else out.push(m[0]);
    } else {
      out.push(<b key={k++} className="font-black text-sky-300">你</b>);
    }
    last = re.lastIndex;
  }
  if (last < str.length) out.push(str.slice(last));
  return <>{out}</>;
}
