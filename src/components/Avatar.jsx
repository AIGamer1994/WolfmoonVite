import React from 'react';

export function Avatar({ p, size = 'w-11 h-11', glow = '' }) {
  const [bad, setBad] = React.useState(false);
  if (!p) return <div className={`${size} rounded-full bg-slate-700 p-0.5 shadow shrink-0 ${glow}`} />;
  return (
    <div className={`${size} rounded-full bg-gradient-to-tr ${p.gradient || 'from-slate-600 to-slate-400'} p-0.5 shadow shrink-0 ${glow}`}>
      {bad
        ? <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-[0.9em] leading-none">{p.emoji}</div>
        : <img src={`https://api.dicebear.com/10.x/critters/svg?seed=${p.seed}`} alt={p.name} onError={() => setBad(true)} className="w-full h-full rounded-full bg-slate-900" />}
    </div>
  );
}
