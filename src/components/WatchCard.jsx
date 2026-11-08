import React from 'react';

// 互動對話框組件
export function WatchCard({ c, icon, selected, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`relative rounded-lg border-2 px-1.5 pt-1.5 pb-1 bg-slate-800 flex flex-col items-center gap-0.5 transition ${selected ? 'border-amber-400 ring-2 ring-amber-400/70 -translate-y-0.5' : 'border-slate-600'}`}>
      <span className="absolute left-1.5 top-1 font-mono font-black text-amber-300 text-sm leading-none">{c.value}</span>
      <i className={`fa-solid ${icon || c.icon || 'fa-circle'} text-amber-400 text-lg mt-3`}></i>
      <span className="text-[10px] font-black text-amber-100 leading-tight">{c.title}</span>
      <span className="text-[8px] text-slate-400 leading-tight text-center">{c.desc}</span>
    </button>
  );
}
