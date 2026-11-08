import React from 'react';
import { Avatar } from './Avatar.jsx';
import { RichLog } from './RichLog.jsx';
import { LocalPlayerContext } from '../context/LocalPlayerContext.js';
import { FxChip } from '../fx/FxChip.jsx';
import { FxOverlay } from '../fx/cards.jsx';

/**
 * 牌桌畫面（A～F 區）：只負責「畫面長相」，所有狀態與遊戲邏輯都由 App 以 props 傳進來。
 *   A 區：版本／設定列      B 區：動態廣播
 *   C 區：月亮、牌庫數目    D 區：其他玩家
 *   E 區：戰場（面前牌、出牌、動畫）   F 區：自己的手牌與操作
 * 想改版面、間距、顏色、文字，改這個檔案即可。
 */
export function GameBoard(props) {
  const {
    actionLocked, arenaFocus, arenaRef, broadcastEvent, canStartNextGame, centerCards,
    changeSpeed, closeReplay, currentTurnIndex, deck, dragGhost, drawAnim, drunkSeen, fx,
    gameOver, getFrontCards, handleActionA, handleActionB, handleHandPointerCancel,
    handleHandPointerDown, handleHandPointerMove, handleHandPointerUp, handleNextGame,
    humanPlayerId, humanPlayerName, iAmReadyNext, isCardActive, isMyTurn, isReturningCenterCard,
    lastBroadcastFx, moonPhase, myHand, nextGameBusy, nextGameLabel, onlineSession,
    otherPlayersOrdered, playBroadcastFx, playedCardArena, playerHands, players,
    privateBroadcastVisible, recentArenaCards, replay, reserveCards, reserveDrawRef, revealChip,
    seerSeen, selectedHandCard, setArenaFocus, setCenterPickMode, setIsCenterCardsModalOpen,
    setIsDeckModalOpen, setIsHistoryModalOpen, setIsRulesModalOpen, setOnlineSession, setScreen,
    setShowBroadcast, setVictoryDismissed, showBroadcast, skipFx, speed, version,
    victoryDismissed, visibleBroadcastAction, visibleBroadcastResult, visibleBroadcastReveal,
    winnerInfo, wins, witchTargetOwner,
  } = props;
  return (
    <>
    {/* A區: 版本設定區 */}
    <header className="h-[4.5%] min-h-[32px] bg-slate-900/90 backdrop-blur border-b border-cyan-900/40 px-3 flex items-center justify-between z-[80] shrink-0">
      <div className="flex items-center">
        <span className="text-[10px] font-mono font-bold text-cyan-400 tracking-tight">
          {version}
        </span>
      </div>
      <div className="flex items-center space-x-1.5">
        <button
          onClick={() => {
            if (onlineSession) setScreen('lobby');
            else { setOnlineSession(false); setScreen('home'); }
          }}
          className="flex items-center justify-center h-6 gap-0.5 whitespace-nowrap bg-slate-800/90 border border-slate-500/50 text-slate-300 text-[10px] font-bold px-1.5 rounded-md shadow-sm active:scale-95"
          title="返回大廳"
        >
          <i className="fa-solid fa-arrow-left text-[9px]"></i>
          <span>大廳</span>
        </button>
        <button onClick={() => setShowBroadcast(v => !v)} className={`flex items-center justify-center h-6 whitespace-nowrap border text-[10px] font-bold px-1.5 rounded-md shadow-sm active:scale-95 ${showBroadcast ? 'bg-emerald-500/25 border-emerald-400/70 text-emerald-200' : 'bg-slate-800/90 border-slate-600/60 text-slate-400'}`}>動態</button>
        {[0.5].map(v => (
          <button key={v} onClick={() => changeSpeed(v)} className={`flex items-center justify-center h-6 whitespace-nowrap border text-[10px] font-mono font-bold px-1.5 rounded-md shadow-sm active:scale-95 ${speed === v ? 'bg-sky-500/25 border-sky-400/80 text-sky-200' : 'bg-slate-800/90 border-slate-500/50 text-slate-400'}`}>{v}x</button>
        ))}
        <button onClick={() => setIsRulesModalOpen(true)} className="flex items-center justify-center h-6 gap-1 whitespace-nowrap bg-slate-800/90 border border-amber-500/40 text-amber-300 text-[11px] px-2 rounded-md shadow-sm active:scale-95">
          <i className="fa-solid fa-book-open text-amber-400 text-[10px]"></i>
          <span className="font-bold text-[10px]">規則</span>
        </button>
        <button onClick={() => setIsHistoryModalOpen(true)} className="flex items-center justify-center h-6 gap-1 whitespace-nowrap bg-slate-800/90 border border-purple-500/40 text-purple-300 text-[11px] px-2 rounded-md shadow-sm active:scale-95">
          <i className="fa-solid fa-clock-rotate-left text-purple-400 text-[10px]"></i>
          <span className="font-bold text-[10px]">紀錄</span>
        </button>
      </div>
    </header>

    {/* B區: 動態區（固定一列，可由 A 區「動態」開關；可點播放當前動畫） */}
    {showBroadcast && (
      <div className="shrink-0 px-2 py-1 border-b border-slate-800/80 bg-slate-900/70 z-[70]">
        <div key={broadcastEvent ? broadcastEvent.key : 'plain'} className={`w-full bg-slate-900/95 border px-2 py-1 rounded-lg shadow flex items-stretch gap-1.5 min-h-[36px] ${broadcastEvent ? (broadcastEvent.type === 'out' ? 'event-out' : 'event-revive') : 'border-emerald-500/50'}`}>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center space-x-1.5 overflow-hidden">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
              <span className="text-[11px] font-black text-emerald-300 truncate tracking-wide"><RichLog text={visibleBroadcastAction} nameClass="text-amber-300" localPlayerName={onlineSession ? humanPlayerName : null} /></span>
              {privateBroadcastVisible && <span className="ml-auto shrink-0 text-[9px] font-bold text-sky-300"><i className="fa-solid fa-lock mr-0.5"></i>僅你可見</span>}
              {broadcastEvent && (
                <span className={`ml-auto shrink-0 flex items-center text-[9px] font-black ${broadcastEvent.type === 'out' ? 'text-rose-300' : 'text-emerald-300'}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 animate-pulse ${broadcastEvent.type === 'out' ? 'bg-rose-400' : 'bg-emerald-400'}`}></span>{broadcastEvent.type === 'out' ? '出局' : '復活'}
                </span>
              )}
            </div>
            {(visibleBroadcastResult || visibleBroadcastReveal) && (
              <div className="text-[10px] font-bold text-amber-300 truncate pl-3.5 mt-0.5">
                <RichLog text={visibleBroadcastResult} nameClass="text-amber-300" localPlayerName={onlineSession ? humanPlayerName : null} />
                {visibleBroadcastReveal && <span className="text-fuchsia-300 ml-1"><i className="fa-solid fa-eye mr-0.5"></i><RichLog text={visibleBroadcastReveal} nameClass="text-fuchsia-100" localPlayerName={onlineSession ? humanPlayerName : null} /></span>}
              </div>
            )}
          </div>
          {lastBroadcastFx && (
            <button
              type="button"
              onClick={playBroadcastFx}
              className="shrink-0 self-center flex items-center justify-center w-8 h-8 rounded-full bg-sky-500/20 border border-sky-400/60 text-sky-300 active:scale-95"
              title="播放此動態動畫"
            >
              <i className="fa-solid fa-play text-[11px]"></i>
            </button>
          )}
        </div>
      </div>
    )}

    {/* C區: 牌庫數目區（點牌庫／暗牌可開彈窗，同現有） */}
    <div className="shrink-0 px-2 py-1 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between gap-1 z-[70]">
      <div className="flex items-center space-x-1 bg-slate-900/90 border border-amber-500/40 px-2 py-0.5 rounded-full text-[9.5px] shadow">
        <i className="fa-solid fa-moon text-amber-400"></i>
        <span className="text-slate-400">月亮</span>
        <span className="font-mono text-amber-400 font-bold">{moonPhase}/3</span>
      </div>
      <div className="flex items-center space-x-1">
        <div className="flex items-center justify-center h-[22px] space-x-1 bg-slate-900/90 border border-cyan-500/40 px-2 rounded-full text-[9.5px] shadow">
          <i className="fa-solid fa-box-archive text-cyan-400"></i>
          <span className="font-bold text-cyan-300">備用 <span className="font-mono text-cyan-400">{(reserveCards || []).filter(Boolean).length}</span></span>
        </div>
        <button
          onClick={() => { setCenterPickMode(false); setIsCenterCardsModalOpen(true); }}
          className="flex items-center justify-center h-[22px] space-x-1 bg-slate-900/90 border border-amber-500/50 hover:border-amber-400 px-2 rounded-full text-[9.5px] shadow active:scale-95 transition-all cursor-pointer"
        >
          <i className="fa-solid fa-eye text-amber-400"></i>
          <span className="font-bold text-amber-300">暗牌 <span className="font-mono text-amber-400">{(centerCards || []).filter(Boolean).length}</span></span>
        </button>
        <button
          onClick={() => setIsDeckModalOpen(true)}
          className="flex items-center justify-center h-[22px] space-x-1 bg-slate-900/90 border border-amber-500/50 hover:border-amber-400 px-2 rounded-full text-[9.5px] shadow active:scale-95 transition-all cursor-pointer"
        >
          <i className="fa-solid fa-layer-group text-amber-400"></i>
          <span className="font-bold text-amber-300">牌庫 <span className="font-mono text-amber-400">{(deck || []).length}</span></span>
        </button>
      </div>
    </div>

    {/* D區: 除自己以外的玩家（左＝下家 … 右＝上家；名字與框底多留空白） */}
    <section className="shrink-0 bg-slate-900/60 border-b border-slate-800/80 px-1 py-0.5 flex items-center overflow-hidden gap-1" style={{ minHeight: 50 }}>
      {otherPlayersOrdered.map((player) => {
        const idx = players.findIndex(p => p.id === player.id);
        const isTurn = currentTurnIndex === idx;
        const isDead = player.status === '出局';
        return (
          <div
            key={player.id}
            className={`player-box min-w-0 basis-0 flex-1 bg-slate-800/70 rounded-lg px-0.5 pt-0.5 pb-1.5 flex flex-col items-center justify-center relative transition-all duration-300 ${
              isTurn ? 'border-2 border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.65)] scale-[1.02]' : 'border border-slate-700/60 opacity-85'
            } ${isDead ? 'grayscale opacity-30' : ''}`}
          >
            {(() => {
              const activeN = getFrontCards(player).filter(c => isCardActive(player, c)).length;
              const winN = Math.min(wins[player.id] || 0, 3);
              return (
                <div className="w-full h-[10px] shrink-0 flex flex-nowrap items-center justify-center gap-[2px] overflow-hidden whitespace-nowrap text-[7px] leading-none font-bold">
                  {winN > 0 && <span className="flex items-center gap-px text-amber-300">{Array.from({ length: winN }).map((_, i) => <i key={i} className="fa-solid fa-moon"></i>)}</span>}
                  {activeN > 0 && <span title="生效中" className="flex items-center text-emerald-300"><i className="fa-solid fa-bolt"></i><span>{activeN}</span></span>}
                  {player.protected && !isDead && <span className="text-cyan-300"><i className="fa-solid fa-shield-halved"></i></span>}
                  {witchTargetOwner && witchTargetOwner.targetId === player.id && <span className="text-purple-300"><i className="fa-solid fa-wand-magic-sparkles"></i></span>}
                  {witchTargetOwner && witchTargetOwner.witchOwnerId === player.id && <span className="text-pink-300"><i className="fa-solid fa-hat-wizard"></i></span>}
                </div>
              );
            })()}
            <div className={`w-6 h-6 shrink-0 rounded-full bg-gradient-to-tr ${player.gradient} p-0.5 shadow`}>
              <img src={`https://api.dicebear.com/10.x/critters/svg?seed=${player.seed}`} alt={player.name} className="w-full h-full rounded-full bg-slate-900" />
            </div>
            <span className={`text-[9px] truncate w-full text-center leading-none mt-0.5 mb-0.5 ${isTurn ? 'font-black text-emerald-300' : 'font-bold text-slate-200'}`}>{player.name}</span>
          </div>
        );
      })}
    </section>

    {/* E區: 面前區 — 上：各對手面前牌（對齊 D）；中：出牌／動畫；下：自己面前牌 */}
    <main ref={arenaRef} className="flex-1 min-h-0 bg-gradient-to-b from-slate-950 via-slate-900/80 to-slate-950 px-1.5 pt-0 pb-0.5 flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none"></div>

      {/* 拖曳手牌時的放開區提示 */}
      {dragGhost && (
        <div className={`absolute inset-1 rounded-xl border-2 border-dashed pointer-events-none z-30 flex items-center justify-center transition ${dragGhost.over ? 'border-emerald-400 bg-emerald-500/10' : 'border-amber-400/60 bg-amber-500/5'}`}>
          <span className="text-xs font-black text-amber-200 bg-slate-950/80 px-3 py-1 rounded-full">{isReturningCenterCard ? '放開以放回暗牌' : '放開以出牌'}</span>
        </div>
      )}

      {/* E 上：其他玩家面前的牌（對齊 D：左＝下家 … 右＝上家；數值+名稱；最新一張較完整顯示） */}
      {!(gameOver && victoryDismissed) && (
        <div className="relative z-10 w-full flex gap-1 shrink-0 mb-0.5 items-start">
          {otherPlayersOrdered.map(player => {
            // 字級對齊中間出牌卡（title text-[9px]、數值 text-[10px]）；無牌不顯示「—」
            const fronts = getFrontCards(player);
            const step = 15;
            const foldedH = 26;
            const fullH = 52;
            const n = fronts.length;
            const stackH = n === 0 ? 0 : (n === 1 ? fullH : step * (n - 1) + fullH);
            return (
              <div key={player.id} className="min-w-0 basis-0 flex-1 flex flex-col items-center">
                {n === 0 ? null : (
                <div className="relative w-full max-w-[72px] mx-auto" style={{ height: stackH }}>
                  {fronts.map((c, i) => {
                    const active = isCardActive(player, c);
                    const isLatest = i === n - 1;
                    const borderCls = active ? 'border-2 border-emerald-400' : 'border-2 border-amber-400/80';
                    if (isLatest) {
                      return (
                        <button
                          type="button"
                          key={(c.id || c.title) + '-' + i}
                          onClick={(e) => { e.stopPropagation(); setArenaFocus({ ...c, playedBy: player.name }); }}
                          className={`absolute left-1/2 -translate-x-1/2 w-[96%] rounded-md bg-slate-900 shadow flex flex-col items-center justify-center px-0.5 py-0.5 active:scale-95 ${borderCls}`}
                          style={{ top: n === 1 ? 0 : step * (n - 1), height: fullH, zIndex: i + 1 }}
                          title={`${c.value} ${c.title}${active ? '（生效中）' : ''}`}
                        >
                          <span className="font-mono font-black text-amber-300 text-[10px] leading-none tabular-nums">{c.value}</span>
                          <i className={`fa-solid ${c.icon || 'fa-circle'} text-amber-400 text-[11px] my-0.5`}></i>
                          <span className="text-[9px] font-black text-amber-100 leading-none text-center truncate w-full px-0.5">{c.title}</span>
                        </button>
                      );
                    }
                    return (
                      <button
                        type="button"
                        key={(c.id || c.title) + '-' + i}
                        onClick={(e) => { e.stopPropagation(); setArenaFocus({ ...c, playedBy: player.name }); }}
                        className={`absolute left-1/2 -translate-x-1/2 w-[96%] rounded-md bg-slate-900 shadow flex items-start overflow-hidden active:scale-95 ${borderCls}`}
                        style={{ top: i * step, height: foldedH, zIndex: i + 1 }}
                        title={`${c.value} ${c.title}${active ? '（生效中）' : ''}`}
                      >
                        <span className="w-[20px] shrink-0 text-center font-mono font-black text-amber-300 text-[10px] leading-none pt-0.5 tabular-nums">{c.value}</span>
                        <span className="flex-1 min-w-0 text-center font-black text-amber-100 text-[9px] leading-none pt-0.5 truncate pr-0.5">{c.title}</span>
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* E 中：本回合打出／攤牌／等待 */}
      <div className="w-full flex-1 min-h-0 flex items-center justify-center relative z-10">
        {(gameOver && victoryDismissed) ? (
          <div className="absolute inset-x-0 top-7 bottom-0 overflow-y-auto scrollbar-none px-0.5 space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="font-black text-amber-300 text-[11px]"><i className="fa-solid fa-eye mr-1"></i>全部攤牌</span>
              <button onClick={() => setVictoryDismissed(false)} className="text-[9.5px] font-bold text-purple-300 bg-slate-900/90 border border-purple-500/40 px-2 py-0.5 rounded-full active:scale-95">查看結算</button>
            </div>
            <div className="space-y-1">
              {players.map(p => {
                const hand = (playerHands[p.id] || []).filter(Boolean);
                const isWin = !!(winnerInfo && winnerInfo.winnerIds && winnerInfo.winnerIds.includes(p.id));
                const out = p.status === '出局';
                return (
                  <div key={p.id} className={`flex items-center justify-between gap-1 rounded-lg border px-1.5 py-1 ${isWin ? 'border-amber-400/70 bg-amber-500/10' : 'border-slate-700 bg-slate-900/70'}`}>
                    <span className="flex items-center gap-1 shrink-0">
                      <Avatar p={p} size="w-5 h-5" />
                      <span className={`truncate ${p.id === humanPlayerId ? 'text-sky-300 font-black' : 'text-slate-200 font-bold'}`}>{p.name}</span>
                      {isWin && <span>🏆</span>}
                      {out && <span className="text-[9px] font-black text-rose-300 border border-rose-500/50 rounded px-1">出局</span>}
                    </span>
                    <span className="flex flex-wrap gap-1 justify-end">
                      {hand.length > 0 ? hand.map((c, i) => revealChip(c, i)) : <span className="text-slate-500">{out ? (p.handTaken ? '手牌已被間諜接手' : '手牌已公開於面前') : '無手牌'}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-slate-900/70 px-1.5 py-1">
              <div className="text-[9.5px] font-black text-amber-300 mb-1">中央暗牌</div>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="flex items-center gap-1"><span className="text-slate-400">暗牌{i + 1}</span>{revealChip((centerCards || [])[i], i)}</span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-cyan-500/30 bg-slate-900/70 px-1.5 py-1">
              <div className="text-[9.5px] font-black text-cyan-300 mb-1">備用牌堆</div>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {[0, 1].map(i => (
                  <span key={i} className="flex items-center gap-1"><span className="text-slate-400">備用{i + 1}</span>{revealChip((reserveCards || [])[i], i)}</span>
                ))}
              </div>
            </div>
          </div>
        ) : (playedCardArena || (recentArenaCards && recentArenaCards[0])) ? (
          (() => {
            const c = playedCardArena || recentArenaCards[0];
            return (
              <button
                type="button"
                onClick={() => setArenaFocus(c)}
                className="relative w-[96px] h-[140px] rounded-xl border-2 border-amber-400/90 bg-slate-900 shadow-xl overflow-hidden active:scale-95 animate-card-play select-none"
              >
                <div className="h-full p-1.5 flex flex-col justify-between">
                  <div className="flex items-start justify-between gap-0.5">
                    <span className="bg-amber-500 text-slate-950 text-[10px] font-black min-w-[18px] h-[18px] px-0.5 rounded-full flex items-center justify-center font-mono">{c.value}</span>
                    {c.isMoon && <span className="text-[8px] text-amber-300 font-bold">月</span>}
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <i className={`fa-solid ${c.icon || 'fa-circle'} text-lg text-amber-400/85`}></i>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-black text-amber-200 leading-tight truncate">{c.title}</div>
                    <div className="text-[8px] text-slate-400 truncate">{c.playedBy || ''}</div>
                  </div>
                </div>
              </button>
            );
          })()
        ) : (
          <div className="text-slate-600 text-xs flex flex-col items-center">
            <i className="fa-solid fa-wolf-pack-battalion text-4xl mb-2 opacity-30"></i>
            等待玩家行動...
          </div>
        )}
      </div>

      {/* E 下：自己面前的牌（由左至右完整顯示、少少重疊；最新在最右且最頂） */}
      {!(gameOver && victoryDismissed) && (() => {
        const me = players.find(p => p.id === humanPlayerId);
        const fronts = me ? getFrontCards(me) : [];
        if (!fronts.length) return <div className="shrink-0 h-1" />;
        const cardW = 56;
        const overlap = 18;
        const totalW = cardW + Math.max(0, fronts.length - 1) * (cardW - overlap);
        return (
          <div className="relative z-10 w-full shrink-0 flex justify-center py-1 px-1">
            <div className="relative" style={{ width: totalW, height: 72 }}>
              {fronts.map((c, i) => {
                const active = isCardActive(me, c);
                return (
                  <button
                    type="button"
                    key={(c.id || c.title) + '-' + i}
                    onClick={(e) => { e.stopPropagation(); setArenaFocus({ ...c, playedBy: me.name }); }}
                    className={`absolute top-0 rounded-md border-2 bg-slate-900 shadow flex flex-col items-center justify-center px-1 py-1 active:scale-95 ${active ? 'border-emerald-400' : 'border-amber-400/80'}`}
                    style={{ left: i * (cardW - overlap), width: cardW, height: 70, zIndex: i + 1 }}
                    title={`${c.value} ${c.title}${active ? '（生效中）' : ''}`}
                  >
                    <span className="font-mono font-black text-amber-300 text-[10px] leading-none">{c.value}</span>
                    <i className={`fa-solid ${c.icon || 'fa-circle'} text-amber-400 text-[11px] my-0.5`}></i>
                    <span className="text-[9px] font-black text-amber-100 leading-none text-center truncate w-full">{c.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 點面前的牌：完整檢視（數值／圖示／名稱／說明） */}
      {arenaFocus && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55" onClick={() => setArenaFocus(null)}>
          <div className="relative w-40 h-[210px] bg-slate-900 border-2 border-amber-400 rounded-2xl p-3 flex flex-col justify-between shadow-2xl animate-arena-focus" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <span className="bg-amber-500 text-slate-950 text-base font-black w-8 h-8 rounded-full flex items-center justify-center font-mono">{arenaFocus.value}</span>
              {arenaFocus.isMoon && <span className="text-[10px] bg-slate-800 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-bold">{arenaFocus.category || '月亮'}</span>}
            </div>
            <div className="w-full h-16 my-1 rounded-lg bg-slate-800 border border-slate-700/70 flex items-center justify-center">
              <i className={`fa-solid ${arenaFocus.icon || 'fa-circle'} text-4xl text-amber-400/85`}></i>
            </div>
            <div className="text-center">
              <h3 className="text-sm font-black text-amber-300">{arenaFocus.title}</h3>
              {arenaFocus.desc && <p className="text-[9px] text-slate-300 line-clamp-3 mt-0.5 leading-tight">{arenaFocus.desc}</p>}
            </div>
            <div className="pt-1.5 border-t border-amber-500/40 flex justify-between items-center text-[10px]">
              <span className="text-amber-400 font-bold">{arenaFocus.isMoon ? '翻開者' : '出牌者'}</span>
              <span className="text-slate-200 font-black">{arenaFocus.playedBy || ''}</span>
            </div>
            <button type="button" onClick={() => setArenaFocus(null)} className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-xs font-black">✕</button>
          </div>
        </div>
      )}

  {replay && replay.fx && <FxOverlay key={`r${replay.n}`} fx={replay.fx} onSkip={closeReplay} replay={{}} localPlayerId={humanPlayerId} />}
  {!replay && fx && (!fx.privateTo?.length || fx.privateTo.includes(humanPlayerId)) && !(gameOver && victoryDismissed) && (
    <FxOverlay key={fx.key} fx={fx} onSkip={skipFx} localPlayerId={humanPlayerId} />
  )}
    </main>

    {/* F區: 手牌區（自己頭像固定左上） */}
    <footer className="hand-dock h-[30%] min-h-[210px] bg-gradient-to-t from-slate-950 via-slate-900 to-slate-950 border-t border-slate-800 p-2 relative shrink-0 flex items-center justify-center">
      {gameOver && victoryDismissed && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/90">
          <button onClick={handleNextGame} disabled={!canStartNextGame || nextGameBusy || (onlineSession && iAmReadyNext)} className="flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-base font-black px-8 py-3 rounded-2xl shadow-lg active:scale-95 animate-pulse disabled:cursor-not-allowed disabled:opacity-60">
            <i className="fa-solid fa-forward-step"></i><span>{nextGameLabel}</span>
          </button>
        </div>
      )}

      {/* F區左上：自己的頭像與狀態 */}
      {(() => {
        const me = players.find(p => p.id === humanPlayerId);
        if (!me) return null;
        const isTurn = currentTurnIndex === players.findIndex(p => p.id === humanPlayerId);
        const isDead = me.status === '出局';
        const fronts = getFrontCards(me);
        const activeN = fronts.filter(c => isCardActive(me, c)).length;
        const winN = Math.min(wins[me.id] || 0, 3);
        return (
          <div
            className={`absolute left-1.5 top-1.5 z-20 flex items-center gap-1.5 rounded-lg px-1.5 py-1 bg-slate-800/90 border transition-all ${
              isTurn ? 'border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.65)]' : 'border-slate-600/70'
            } ${isDead ? 'grayscale opacity-40' : ''}`}
          >
            <div className={`w-8 h-8 shrink-0 rounded-full bg-gradient-to-tr ${me.gradient} p-0.5 shadow`}>
              <img src={`https://api.dicebear.com/10.x/critters/svg?seed=${me.seed}`} alt={me.name} className="w-full h-full rounded-full bg-slate-900" />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className={`text-[10px] font-black leading-none ${isTurn ? 'text-emerald-300' : 'text-sky-300'}`}>{me.name}</span>
              <div className="flex flex-nowrap items-center gap-[3px] overflow-hidden whitespace-nowrap text-[8px] leading-none font-bold">
                {winN > 0 && <span className="flex items-center gap-px text-amber-300">{Array.from({ length: winN }).map((_, i) => <i key={i} className="fa-solid fa-moon"></i>)}</span>}
                {activeN > 0 && <span className="flex items-center text-emerald-300"><i className="fa-solid fa-bolt"></i><span>{activeN}</span></span>}
                {me.protected && !isDead && <span className="text-cyan-300"><i className="fa-solid fa-shield-halved"></i></span>}
                {witchTargetOwner && witchTargetOwner.targetId === me.id && <span className="text-purple-300"><i className="fa-solid fa-wand-magic-sparkles"></i></span>}
                {witchTargetOwner && witchTargetOwner.witchOwnerId === me.id && <span className="text-pink-300"><i className="fa-solid fa-hat-wizard"></i></span>}
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* 拖曳提示（浮在 F 區上緣，不影響版面） */}
      {myHand.filter(Boolean).length === 2 && isMyTurn && !gameOver && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-30 pointer-events-none text-[10px] font-bold text-amber-300 bg-slate-950/80 border border-amber-500/40 px-2.5 py-0.5 rounded-full animate-pulse whitespace-nowrap">
          <i className="fa-solid fa-hand-point-up mr-1"></i>{isReturningCenterCard ? '拖曳 1 張手牌到戰場，放回暗牌' : '拖曳手牌到戰場出牌'}
        </div>
      )}

      {/* F區左下：先知看過的玩家與牌（目標之後換過手牌則變淡並標「舊資訊」） */}
      {seerSeen && (() => {
        const tp = players.find(p => p.id === seerSeen.targetId);
        if (!tp) return null;
        const nowCard = (playerHands[tp.id] || []).filter(Boolean)[0];
        const stale = tp.status !== '存活' || !nowCard || nowCard.id !== seerSeen.card.id;
        const c = seerSeen.card;
        return (
          <div className={`absolute left-1.5 bottom-1.5 z-30 flex flex-col items-center gap-0.5 pointer-events-none ${stale ? 'opacity-50' : ''}`}>
            <span className="text-[7px] leading-none font-black text-sky-300"><i className="fa-solid fa-eye mr-0.5"></i>先知{stale ? '・舊資訊' : ''}</span>
            <LocalPlayerContext.Provider value={humanPlayerId}><FxChip p={tp} size="w-7 h-7 text-sm" /></LocalPlayerContext.Provider>
            <div className="w-9 h-[50px] shrink-0 overflow-hidden rounded-md border-2 border-cyan-500/80 bg-slate-900 flex flex-col items-center justify-center shadow">
              <span className="font-mono font-black text-amber-300 text-[11px] leading-none">{c.value}</span>
              <i className={`fa-solid ${c.icon || 'fa-circle'} text-cyan-400 text-[11px] my-0.5`}></i>
              <span className="text-[7px] font-black text-slate-100 leading-none whitespace-nowrap">{c.title}</span>
            </div>
          </div>
        );
      })()}

      {/* F區左下（先知上方）：醉漢檢視過的在場手牌（洗牌後換過手牌則變淡並標「舊資訊」） */}
      {drunkSeen && drunkSeen.length > 0 && (() => {
        const rows = drunkSeen.map(e => {
          const tp = players.find(p => p.id === e.targetId);
          if (!tp) return null;
          const nowCard = (playerHands[tp.id] || []).filter(Boolean)[0];
          const stale = tp.status !== '存活' || !nowCard || nowCard.id !== e.card.id;
          return { tp, c: e.card, stale };
        }).filter(Boolean);
        if (rows.length === 0) return null;
        const allStale = rows.every(r => r.stale);
        return (
          <div className="absolute left-1.5 z-30 flex flex-col items-start gap-0.5 pointer-events-none" style={{ bottom: seerSeen ? 104 : 6 }}>
            <span className="text-[7px] leading-none font-black text-violet-300">🍺 醉漢看過{allStale ? '・舊資訊' : ''}</span>
            {rows.map(({ tp, c, stale }) => (
              <div key={tp.id} className={`flex items-center gap-0.5 bg-slate-900/80 border border-violet-500/50 rounded pr-1 ${stale ? 'opacity-50' : ''}`}>
                <FxChip p={tp} size="w-4 h-4 text-[9px]" />
                <span className="font-mono font-black text-amber-300 text-[8px] leading-none">{c.value}</span>
                <span className="text-[7px] font-black text-slate-100 leading-none whitespace-nowrap">{c.title}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 手牌區：絕對水平居中 */}
      <div className="absolute inset-0 flex items-center justify-center px-4 pointer-events-none">
        <div className="flex space-x-3 items-center justify-center h-full pointer-events-auto">
          {myHand.filter(Boolean).length > 0 ? (
            myHand.filter(Boolean).map((card) => {
              const isSelected = selectedHandCard?.id === card.id;
              return (
                <div 
                  key={card.id}
                  onPointerDown={(e) => handleHandPointerDown(e, card)}
                  onPointerMove={handleHandPointerMove}
                  onPointerUp={handleHandPointerUp}
                  onPointerCancel={handleHandPointerCancel}
                  className={`hand-card relative w-[130px] h-[190px] bg-slate-900 border-2 rounded-xl p-2 flex flex-col justify-between shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ${dragGhost && dragGhost.card.id === card.id ? 'opacity-30' : ''} ${drawAnim && drawAnim.card && drawAnim.card.id === card.id ? 'opacity-0' : ''} ${
                    isSelected ? 'selected border-amber-400' : 'border-cyan-500/80 hover:border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className={`${isSelected ? 'bg-amber-500' : 'bg-cyan-500'} text-slate-950 text-sm font-black w-6 h-6 rounded-full flex items-center justify-center font-mono`}>{card.value}</span>
                  </div>
                  <div className="w-full h-16 bg-slate-800/90 rounded-lg border border-slate-700/60 flex items-center justify-center my-1">
                    <i className={`fa-solid ${card.icon} text-3xl text-cyan-400 filter drop-shadow`}></i>
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-black text-slate-100 truncate tracking-wide">{card.title}</div>
                    <div className="text-[8.5px] text-slate-300 line-clamp-3 leading-tight mt-0.5">{card.desc}</div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-slate-500 text-xs">無手牌</div>
          )}
        </div>
      </div>

      {/* 抽牌小動畫：牌背飛入 ➔ 翻面 ➔ 短暫放大 ➔ 歸位（只有玩家自己抽牌才播；AI 抽牌不公開） */}
      {drawAnim && drawAnim.card && (() => {
        const k = drawAnim.k, c = drawAnim.card;
        const sx = drawAnim.from === 'center' ? 0 : 110;
        return (
          <div key={drawAnim.key} className="absolute inset-0 z-[35] flex items-center justify-center pointer-events-none">
            <div style={{ transform: `translateX(${drawAnim.toX}px)` }}>
              <div style={{ '--sx': `${sx}px`, '--sy': '-260px', animation: `fxDrawFly ${0.5 * k}s cubic-bezier(.2,.8,.3,1) both` }}>
                <div style={{ animation: `fxDrawPop ${0.68 * k}s ease-in-out ${0.72 * k}s both` }}>
                  <div className="relative w-[130px] h-[190px]">
                    <div className="absolute inset-0" style={{ animation: `fxFlipOut ${0.18 * k}s ease-in ${0.5 * k}s both` }}>
                      <div className="w-full h-full rounded-xl border-2 border-amber-500/70 bg-gradient-to-br from-indigo-900 to-slate-800 flex items-center justify-center shadow-xl">
                        <i className="fa-solid fa-moon text-amber-400/80 text-3xl"></i>
                      </div>
                    </div>
                    <div className="absolute inset-0" style={{ animation: `fxFlipIn ${0.22 * k}s ease-out ${0.68 * k}s both` }}>
                      <div className="w-full h-full bg-slate-900 border-2 border-cyan-500/80 rounded-xl p-2 flex flex-col justify-between" style={{ animation: `fxDrawGlow ${0.68 * k}s ease-in-out ${0.72 * k}s both` }}>
                        <div className="flex justify-between items-center">
                          <span className="bg-cyan-500 text-slate-950 text-sm font-black w-6 h-6 rounded-full flex items-center justify-center font-mono">{c.value}</span>
                        </div>
                        <div className="w-full h-16 bg-slate-800/90 rounded-lg border border-slate-700/60 flex items-center justify-center my-1">
                          <i className={`fa-solid ${c.icon} text-3xl text-cyan-400 filter drop-shadow`}></i>
                        </div>
                        <div className="text-center">
                          <div className="text-xs font-black text-slate-100 truncate tracking-wide">{c.title}</div>
                          <div className="text-[8.5px] text-slate-300 line-clamp-3 leading-tight mt-0.5">{c.desc}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 右側浮動操作按鈕 */}
      <div className={`absolute right-2 top-1/2 -translate-y-1/2 w-[16%] max-w-[70px] h-[90%] flex flex-col justify-center space-y-2 z-20 p-1 ${myHand.length === 1 ? '' : 'hidden'}`}>
        {myHand.length === 1 && (
          <>
            <button 
              onClick={handleActionA}
              style={isMyTurn && !gameOver && !actionLocked ? { animation: 'btnBlinkG 1.4s ease-in-out infinite' } : undefined}
              disabled={!isMyTurn || gameOver || actionLocked}
              className="w-full group relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/40 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 rounded-xl py-2 px-1 transition-all duration-300 active:scale-95 shadow-md flex flex-col items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center mb-0.5 border border-emerald-400/40">
                <i className="fa-solid fa-plus text-[10px] text-emerald-400"></i>
              </div>
              <span className="text-[9.5px] font-black text-emerald-200">{reserveDrawRef.current === humanPlayerId && deck.length === 0 ? '抽備用牌' : '抽一打一'}</span>
            </button>
            
            <button 
              onClick={handleActionB}
              style={isMyTurn && !gameOver && !actionLocked ? { animation: 'btnBlinkB 1.4s ease-in-out infinite' } : undefined}
              disabled={centerCards.filter(Boolean).length === 0 || !isMyTurn || gameOver || actionLocked}
              className="w-full group relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-900 to-blue-950/40 border border-blue-500/40 hover:border-blue-400 text-blue-300 rounded-xl py-2 px-1 transition-all duration-300 active:scale-95 shadow-md flex flex-col items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center mb-0.5 border border-blue-400/40">
                <i className="fa-solid fa-hand-pointer text-[10px] text-blue-400"></i>
              </div>
              <span className="text-[9.5px] font-black text-blue-200">拿一還一</span>
            </button>
          </>
        )}

                          </div>
    </footer>
    </>
  );
}
