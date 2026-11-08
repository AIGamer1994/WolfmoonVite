import React from 'react';
import { Avatar } from './Avatar.jsx';

export function PlayerPicker({ label, options, value, onChange, humanPlayerId }) {
  return (
    <div>
      <label className="block text-slate-400 mb-1">{label}</label>
      {options.length === 0 ? <div className="text-slate-500 py-1">無可選目標</div> : (
        <div className="grid grid-cols-3 gap-1.5">
          {options.map(p => {
            const sel = value === String(p.id);
            return (
              <button type="button" key={p.id} onClick={() => onChange(String(p.id))} className={`flex flex-col items-center rounded-lg border py-1.5 active:scale-95 ${sel ? 'border-emerald-400 bg-emerald-500/20 ring-2 ring-emerald-400/60' : 'border-slate-700 bg-slate-800'}`}>
                <Avatar p={p} size="w-9 h-9" />
                <span className={`text-[10px] font-bold mt-0.5 truncate max-w-full px-0.5 ${p.id === humanPlayerId ? 'text-sky-300' : 'text-slate-200'}`}>{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
