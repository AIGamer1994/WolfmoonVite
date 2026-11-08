import React, { useState } from 'react';
import { Avatar } from './Avatar.jsx';
import { PlayerPicker } from './PlayerPicker.jsx';
import { WatchCard } from './WatchCard.jsx';
import { LocalPlayerContext } from '../context/LocalPlayerContext.js';
import { FxChip } from '../fx/FxChip.jsx';
import { FxFace, playedCardsOf } from '../fx/cards.jsx';
import { canSteal } from '../utils/cards.js';

export function InteractionDialog({ modal, players, humanPlayerId, playerHands, centerCards, remainingCounts, allCards, onSubmit, onCancel }) {
  const preId = modal && modal.preselectTargetId != null ? String(modal.preselectTargetId) : '';
  const [selectedTarget, setSelectedTarget] = useState(preId);
  const [secondaryTarget, setSecondaryTarget] = useState('');
  const [guessedVal, setGuessedVal] = useState('');
  const [guessedVal2, setGuessedVal2] = useState('');
  const [selectedStolenCard, setSelectedStolenCard] = useState('');
  const [selectedKeepCard, setSelectedKeepCard] = useState('');

  const aliveTargets = players.filter(p => p.id !== humanPlayerId && p.status === '存活' && !p.protected);
  const deadTargets = players.filter(p => p.status === '出局');
  const preselectOnly = !!preId;
  const prePlayer = preId ? players.find(p => String(p.id) === preId) : null;
  const pickpocketPool = [players.find(p => p.id === humanPlayerId), ...aliveTargets].filter(Boolean).slice(0, 6);
  const togglePickpocket = (idStr) => {
    if (selectedTarget === idStr) {
      setSelectedTarget(secondaryTarget);
      setSecondaryTarget('');
      return;
    }
    if (secondaryTarget === idStr) {
      setSecondaryTarget('');
      return;
    }
    if (!selectedTarget) setSelectedTarget(idStr);
    else if (!secondaryTarget) setSecondaryTarget(idStr);
    else {
      // 已選滿兩個：以新點替換第二個
      setSecondaryTarget(idStr);
    }
  };
  // 刺客雙猜測：與扒手相同邏輯（第1下／第2下，再點取消）
  const toggleAssassinGuess = (vStr) => {
    if (guessedVal === vStr) {
      setGuessedVal(guessedVal2);
      setGuessedVal2('');
      return;
    }
    if (guessedVal2 === vStr) {
      setGuessedVal2('');
      return;
    }
    if (!guessedVal) setGuessedVal(vStr);
    else if (!guessedVal2) setGuessedVal2(vStr);
    else setGuessedVal2(vStr);
  };

  const isGuess = modal.type === 'VILLAGER' || modal.type === 'ASSASSIN';

  // 猜測用：各數值尚未現身的角色與張數（牌庫清單的剩餘數，再扣掉自己手上的牌）
  const unseenText = (v) => {
    const myTitles = (playerHands[humanPlayerId] || []).filter(Boolean).map(c => c.title);
    const parts = (allCards || []).filter(c => c.value === v).map(c => {
      const base = ((remainingCounts || {})[c.title] || { current: c.totalCount }).current;
      const n = Math.max(0, base - myTitles.filter(t => t === c.title).length);
      return n > 0 ? `${c.title}${n > 1 ? '×' + n : ''}` : null;
    }).filter(Boolean);
    return parts.length ? parts.join('、') : '已無';
  };

  // 掘墓人選定的玩家面前可奪取卡牌
  const gravediggerTarget = players.find(p => p.id.toString() === selectedTarget);
  const availableStolenCards = gravediggerTarget ? playedCardsOf(gravediggerTarget).filter(canSteal) : [];

  // 守夜人可選擇的卡牌組合 (手牌 + 中央暗牌)
  const watchmanHand = playerHands[humanPlayerId] || [];
  const watchmanOptions = [...centerCards, ...watchmanHand].filter(Boolean);

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl w-full max-w-xs p-4 shadow-2xl relative">
        <h3 className="text-sm font-bold text-emerald-300 border-b border-slate-800 pb-2 mb-3">
          {modal.title || ('選擇【' + (modal.card ? modal.card.title : '能力') + '】目標')}
        </h3>

        {modal.type === 'INFO' ? (
          <div>
            {modal.infoTarget && (
              <div className="flex flex-col items-center gap-2 mb-4">
                <LocalPlayerContext.Provider value={humanPlayerId}><FxChip p={modal.infoTarget} size="w-11 h-11 text-xl" /></LocalPlayerContext.Provider>
                {modal.infoCard ? (
                  <div className="w-[130px] h-[180px] bg-slate-900 border-2 border-cyan-500/80 rounded-xl p-2 flex flex-col justify-between shadow-[0_0_12px_rgba(6,182,212,0.3)]">
                    <span className="bg-cyan-500 text-slate-950 text-sm font-black w-6 h-6 rounded-full flex items-center justify-center font-mono">{modal.infoCard.value}</span>
                    <div className="w-full h-16 bg-slate-800/90 rounded-lg border border-slate-700/60 flex items-center justify-center my-1">
                      <i className={`fa-solid ${modal.infoCard.icon} text-3xl text-cyan-400`}></i>
                    </div>
                    <div className="text-center">
                      <div className="text-xs font-black text-slate-100 truncate tracking-wide">{modal.infoCard.title}</div>
                      <div className="text-[8.5px] text-slate-300 line-clamp-3 leading-tight mt-0.5">{modal.infoCard.desc}</div>
                    </div>
                  </div>
                ) : <span className="text-xs text-slate-400">無手牌</span>}
              </div>
            )}
            {modal.message && <p className="text-xs text-slate-300 mb-4 whitespace-pre-line">{modal.message}</p>}
            <button onClick={onCancel} className="w-full bg-emerald-600 text-white text-xs py-2 rounded-xl font-bold">確定</button>
          </div>
        ) : modal.type === 'DRUNK_VIEW' ? (
          <div>
            <p className="text-[11px] text-slate-300 mb-3">你拿走了所有玩家的手牌並秘密檢視（只有你看得到）。按下按鈕後，這些牌會面朝下洗勻，再隨機發給每位玩家 1 張。</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {(modal.view || []).map(v => (
                <div key={v.p.id} className="flex flex-col items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-800/60 py-1.5">
                  <LocalPlayerContext.Provider value={humanPlayerId}><FxChip p={v.p} size="w-9 h-9 text-base" /></LocalPlayerContext.Provider>
                  {v.card ? <FxFace c={v.card} cls="w-12 h-[64px]" /> : <span className="text-[10px] text-slate-500 h-[64px] flex items-center">無手牌</span>}
                </div>
              ))}
            </div>
            {modal.skipped && modal.skipped.length > 0 && (
              <div className="text-[10px] font-bold text-cyan-300 mb-3"><i className="fa-solid fa-shield-halved mr-1"></i>{modal.skipped.map(p => p.name).join('、')} 受保護未參與</div>
            )}
            <button onClick={() => onSubmit({ type: 'DRUNK_VIEW' })} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-2 rounded-xl font-bold"><i className="fa-solid fa-shuffle mr-1"></i>洗牌重發</button>
          </div>
        ) : modal.type === 'SERVANT_CHOICE' ? (
          <div>
            <p className="text-xs text-slate-300 mb-4">回合結束，是否棄掉面前的【僕人】立刻進行額外回合？</p>
            <div className="flex space-x-2">
              <button onClick={() => onSubmit({ type: 'SERVANT_CHOICE', servantId: modal.servantId })} className="flex-1 bg-emerald-600 text-white text-xs py-2 rounded-xl font-bold">棄掉並額外回合</button>
              <button onClick={onCancel} className="flex-1 bg-slate-800 text-slate-300 text-xs py-2 rounded-xl">不使用</button>
            </div>
          </div>
        ) : modal.type === 'COUNTER_SPY' ? (
          <div>
            <p className="text-xs text-slate-300 mb-4">其他人猜測您的手牌失敗！是否立刻打出【間諜】反殺該猜測者？</p>
            <div className="flex space-x-2">
              <button onClick={() => onSubmit({ type: 'COUNTER_SPY', attackerId: modal.sourceId })} className="flex-1 bg-emerald-600 text-white text-xs py-2 rounded-xl font-bold">反殺打出</button>
              <button onClick={onCancel} className="flex-1 bg-slate-800 text-slate-300 text-xs py-2 rounded-xl">放棄</button>
            </div>
          </div>
        ) : modal.type === 'CONFIRM_NO_TARGET' ? (
          <div>
            {modal.card && (
              <div className="flex items-center gap-2 mb-3 rounded-lg border border-amber-500/40 bg-slate-800/60 px-2 py-1.5">
                <span className="bg-amber-500 text-slate-950 text-xs font-black w-6 h-6 rounded-full flex items-center justify-center font-mono">{modal.card.value}</span>
                <span className="text-xs font-black text-amber-200">{modal.card.title}</span>
              </div>
            )}
            <p className="text-xs text-slate-300 mb-4 whitespace-pre-line">{modal.message || '目前沒有可選擇的目標。確定打出？'}</p>
            <div className="flex space-x-2">
              <button onClick={() => onSubmit({ type: 'CONFIRM_NO_TARGET', card: modal.card })} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-2 rounded-xl font-bold">確定打出</button>
              <button onClick={onCancel} className="flex-1 bg-slate-800 text-slate-300 text-xs py-2 rounded-xl">取消</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            {/* 守夜人卡牌選擇 */}
            {modal.type === 'NIGHT_WATCHMAN' ? (
              <div className="space-y-2">
                <div className="text-slate-400">中央暗牌（3 張，完整翻開）：</div>
                <div className="grid grid-cols-3 gap-2">
                  {centerCards.filter(Boolean).map(c => (
                    <WatchCard key={c.id} c={c} icon={(allCards.find(x => x.title === c.title) || {}).icon} selected={selectedKeepCard === c.id} onClick={() => setSelectedKeepCard(c.id)} />
                  ))}
                </div>
                <div className="text-slate-400">你現時的手牌：</div>
                <div className="grid grid-cols-3 gap-2">
                  {watchmanHand.filter(Boolean).map(c => (
                    <WatchCard key={c.id} c={c} icon={(allCards.find(x => x.title === c.title) || {}).icon} selected={selectedKeepCard === c.id} onClick={() => setSelectedKeepCard(c.id)} />
                  ))}
                </div>
                <div className="text-[10px] text-slate-500">點選 1 張保留，其餘 3 張面朝下洗勻放回中央。</div>
              </div>
            ) : modal.type === 'GRAVEDIGGER' ? (
              <div className="space-y-1.5">
                <label className="block text-slate-400">點選欲奪取的牌（各玩家面前）：</label>
                {players.filter(p => (p.id === humanPlayerId || !p.protected) && playedCardsOf(p).some(canSteal)).length === 0 && (
                  <div className="text-slate-500 py-1">場上無可奪取的牌</div>
                )}
                <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-0.5 scrollbar-none">
                  {players.filter(p => (p.id === humanPlayerId || !p.protected) && playedCardsOf(p).some(canSteal)).map(p => (
                    <div key={p.id} className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/60 p-1.5">
                      <div className="shrink-0 w-12"><LocalPlayerContext.Provider value={humanPlayerId}><FxChip p={p} size="w-9 h-9 text-base" /></LocalPlayerContext.Provider></div>
                      <div className="flex flex-wrap gap-1.5 min-w-0">
                        {playedCardsOf(p).filter(canSteal).map(c => {
                          const sel = selectedStolenCard === c.id;
                          return (
                            <button type="button" key={c.id} onClick={() => { setSelectedTarget(String(p.id)); setSelectedStolenCard(c.id); }} className={`rounded-md border-2 px-1.5 py-1 flex items-center gap-1 bg-slate-900 active:scale-95 ${sel ? 'border-amber-400 ring-2 ring-amber-400/70' : 'border-slate-600'}`}>
                              <span className="font-mono font-black text-amber-300 text-xs">{c.value}</span>
                              <i className={`fa-solid ${c.icon || 'fa-circle'} text-amber-400 text-[10px]`}></i>
                              <span className="text-[10px] font-black text-amber-100 whitespace-nowrap">{c.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : modal.type === 'WITCH' ? (
              preselectOnly && prePlayer ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-950/30 px-2 py-1.5">
                  <LocalPlayerContext.Provider value={humanPlayerId}><FxChip p={prePlayer} size="w-9 h-9 text-base" /></LocalPlayerContext.Provider>
                  <div className="text-[11px] font-bold text-emerald-200">目標：{prePlayer.name}（唯一可選）</div>
                </div>
              ) : (
                <PlayerPicker label="選擇復活玩家：" value={selectedTarget} onChange={setSelectedTarget} options={deadTargets} humanPlayerId={humanPlayerId} />
              )
            ) : modal.type === 'PICKPOCKET' ? (
              <div>
                <label className="block text-slate-400 mb-1">點選兩位目標（可含自己；再點同一人可取消）</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {pickpocketPool.map(p => {
                    const idStr = String(p.id);
                    const slot = selectedTarget === idStr ? 1 : secondaryTarget === idStr ? 2 : 0;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => togglePickpocket(idStr)}
                        className={`relative flex flex-col items-center rounded-lg border py-1.5 active:scale-95 ${
                          slot ? 'border-emerald-400 bg-emerald-500/20 ring-2 ring-emerald-400/60' : 'border-slate-700 bg-slate-800'
                        }`}
                      >
                        {slot > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-emerald-500 text-[10px] font-black text-slate-950 flex items-center justify-center shadow">{slot}</span>
                        )}
                        <Avatar p={p} size="w-9 h-9" />
                        <span className={`text-[10px] font-bold mt-0.5 truncate max-w-full px-0.5 ${p.id === humanPlayerId ? 'text-sky-300' : 'text-slate-200'}`}>{p.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 text-[10px] text-slate-500">
                  {selectedTarget && secondaryTarget
                    ? `已選：${players.find(p => String(p.id) === selectedTarget)?.name || '?'} ↔ ${players.find(p => String(p.id) === secondaryTarget)?.name || '?'}`
                    : selectedTarget
                      ? `已選第 1 位，請再選第 2 位`
                      : '請選擇兩位玩家互換手牌'}
                </div>
              </div>
            ) : preselectOnly && prePlayer ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-950/30 px-2 py-1.5">
                <LocalPlayerContext.Provider value={humanPlayerId}><FxChip p={prePlayer} size="w-9 h-9 text-base" /></LocalPlayerContext.Provider>
                <div className="text-[11px] font-bold text-emerald-200">目標：{prePlayer.name}（唯一可選）</div>
              </div>
            ) : (
              <PlayerPicker label={modal.type === 'BOUNTY_HUNTER' ? '選擇目標（可選自己）：' : '選擇對手目標：'} value={selectedTarget} onChange={setSelectedTarget} options={modal.type === 'BOUNTY_HUNTER' ? [players.find(p => p.id === humanPlayerId), ...aliveTargets].filter(Boolean) : aliveTargets} humanPlayerId={humanPlayerId} />
            )}

            {/* 村民：單選數值；刺客：雙選數值（同扒手：第1／第2下，再點取消，角標1／2） */}
            {modal.type === 'VILLAGER' && (
              <div>
                <label className="block text-slate-400 mb-1.5">宣告手牌數值 (0–10)：</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[...Array(11).keys()].map(v => {
                    const sel = guessedVal === String(v);
                    return (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setGuessedVal(String(v))}
                        className={`rounded-lg border px-1 py-1.5 text-center active:scale-95 transition ${sel ? 'border-amber-400 bg-amber-500/20 ring-2 ring-amber-400/50' : 'border-slate-700 bg-slate-800'}`}
                      >
                        <div className={`font-mono font-black text-sm ${sel ? 'text-amber-300' : 'text-slate-200'}`}>{v}</div>
                        <div className="text-[8px] leading-tight text-slate-400 mt-0.5 line-clamp-2">{unseenText(v)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {modal.type === 'ASSASSIN' && (
              <div>
                <label className="block text-slate-400 mb-1">點選兩個數值（再點同一數值可取消）</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[...Array(11).keys()].map(v => {
                    const vStr = String(v);
                    const slot = guessedVal === vStr ? 1 : guessedVal2 === vStr ? 2 : 0;
                    return (
                      <button
                        type="button"
                        key={v}
                        onClick={() => toggleAssassinGuess(vStr)}
                        className={`relative rounded-lg border px-1 py-1.5 text-center active:scale-95 transition ${
                          slot ? 'border-amber-400 bg-amber-500/20 ring-2 ring-amber-400/50' : 'border-slate-700 bg-slate-800'
                        }`}
                      >
                        {slot > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-amber-400 text-[10px] font-black text-slate-950 flex items-center justify-center shadow">{slot}</span>
                        )}
                        <div className={`font-mono font-black text-sm ${slot ? 'text-amber-300' : 'text-slate-200'}`}>{v}</div>
                        <div className="text-[8px] leading-tight text-slate-400 mt-0.5 line-clamp-2">{unseenText(v)}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 text-[10px] text-slate-500">
                  {guessedVal !== '' && guessedVal2 !== ''
                    ? `已選：(${guessedVal}) 與 (${guessedVal2})`
                    : guessedVal !== ''
                      ? `已選第 1 個（${guessedVal}），請再選第 2 個`
                      : '請選擇兩個猜測數值'}
                </div>
              </div>
            )}

            <div className="flex space-x-2 pt-2">
              <button 
                disabled={
                  modal.type === 'NIGHT_WATCHMAN' ? !selectedKeepCard :
                  modal.type === 'GRAVEDIGGER' ? (!selectedTarget || !selectedStolenCard) :
                  modal.type === 'PICKPOCKET' ? (!selectedTarget || !secondaryTarget) :
                  modal.type === 'ASSASSIN' ? (!selectedTarget || guessedVal === '' || guessedVal2 === '') :
                  modal.type === 'VILLAGER' ? (!selectedTarget || guessedVal === '') :
                  !selectedTarget
                }
                onClick={() => onSubmit({ 
                  type: modal.type, 
                  targetId: parseInt(selectedTarget), 
                  secondaryTargetId: parseInt(secondaryTarget), 
                  guessedValue: guessedVal,
                  guessedValue2: guessedVal2,
                  stolenCardId: selectedStolenCard,
                  keepCardId: selectedKeepCard
                })} 
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-2 rounded-xl"
              >
                確認發動
              </button>
              <button onClick={onCancel} className="bg-slate-800 text-slate-300 px-3 py-2 rounded-xl">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
