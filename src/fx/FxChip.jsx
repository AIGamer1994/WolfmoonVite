import React from 'react';
import { Avatar } from '../components/Avatar.jsx';
import { LocalPlayerContext } from '../context/LocalPlayerContext.js';

export function FxChip({ p, size = 'w-11 h-11 text-xl', dim = false, glow = '' }) {
  const localPlayerId = React.useContext(LocalPlayerContext);
  if (!p) return null;
  return (
    <div className={`flex flex-col items-center gap-0.5 ${dim ? 'opacity-40' : ''}`}>
      <Avatar p={p} size={size} glow={glow} />
      <span className={`text-[10px] leading-none font-black whitespace-nowrap ${p.id === localPlayerId ? 'text-sky-300' : 'text-slate-100'}`}>{p.name}</span>
    </div>
  );
}
