import React from 'react';
import { createPortal } from 'react-dom';
import './cards.css';

const { useState, useEffect, useMemo, useRef } = React;

// ==== FX START：C 區效果動畫（純視覺疊層，不影響遊戲流程；公開／私密內容由呼叫端篩選）====
        const FX_KIND = {
          '村民': 'guess', '刺客': 'guess', '稅務官': 'ask', '審判官': 'ask', '先知': 'peek',
          '酒保': 'compare', '小女孩': 'compare', '小偷': 'swap', '扒手': 'swap', '醉漢': 'drunk',
          '守夜人': 'watch', '保鏢': 'shield', '賞金獵人': 'bounty', '掘墓人': 'grave', '女巫': 'witch',
          '市長': 'selfout', '狼人': 'selfout',
        };
        const FX_DURATION = { moon: 3200, guess: 2700, ask: 2500, peek: 2800, compare: 7000, swap: 2700, drunk: 4000, watch: 2700, takeone: 2700, shield: 2100, bounty: 2800, grave: 3600, witch: 2500, selfout: 2100, plain: 2200, none: 1600, place: 3200, servant: 3200, alchemist: 3600, wolfbite: 4300, vampire: 6500, match: 7200 };
        // 被動牌打出時「沒有任何效果（原因）」的原因（動態廣播、行動紀錄、置於面前動畫共用）
        const PASSIVE_WHY = {
          '乞丐之王': '結算時才發動',
          '間諜': '手握此牌被猜錯時才發動',
          '科學怪人': '手握此牌結算時才發動',
          '商人': '結算時才發動',
          '煉金術士': '被淘汰才會發動',
          '陰謀家': '手握此牌被淘汰時才會發動',
          '叛徒': '手握此牌狼人獲勝時才發動',
        };
        // 動畫播完後最後一格多停留的時間：無任何效果（置於面前）停 2 秒，其他動畫停 1 秒
        const fxHold = (f) => (f && f.kind === 'place' ? 2000 : (f && f.kind === 'moon' ? 800 : 1000));
        const FX_SHOW_NONE = false; // 「無效果」小標籤動畫：目前關閉（程式保留，改 true 即恢復）
        const FX_TOTAL = 4000; // 效果動畫總長（毫秒）；內部各步驟依 baseDur 等比放慢
        const FX_TOTAL_BY = { compare: 7000, grave: 4800, peek: 3600, place: 4000, servant: 4000, alchemist: 4200, drunk: 5000, wolfbite: 4300, vampire: 6500, match: 7200 }; // 個別動畫的總長（沒列出的用 FX_TOTAL）
        const FX_STAMP_TEXT = { out: '淘汰', fail: '✘ 失敗', nofx: '✘ 無效', revive: '復活', spy: '間諜反殺', tie: '平手' };
        const FX_STAMP_CLS = {
          out: 'text-rose-400 border-rose-400', fail: 'text-slate-200 border-slate-400', nofx: 'text-slate-300 border-slate-500',
          ok: 'text-amber-300 border-amber-400', revive: 'text-emerald-300 border-emerald-400', tie: 'text-sky-300 border-sky-400',
          spy: 'text-fuchsia-300 border-fuchsia-400',
        };
        const playedCardsOf = player => Array.isArray(player && player.playedCards) ? player.playedCards : [];

        // 由「動作行 + 結果行」推導動畫內容；呼叫端決定傳入公開或玩家私密資訊。
        function deriveFx(actionText, resultText, reveal, st) {
          const action = String(actionText || '');
          const res = String(resultText || '');
          const players = st && Array.isArray(st.players) ? st.players : [];
          const orderedPlayers = [...players].sort((a, b) => String(b.name || '').length - String(a.name || '').length);
          const byName = name => name ? (players.find(p => p.name === name) || null) : null;
          const parseMine = text => {
            const match = /(?:你|\S+) 換出 \((\d+)\)【([^】]+)】、取得 \((\d+)\)【([^】]+)】/.exec(String(text || ''));
            if (!match) return null;
            const card = (value, title) => {
              const meta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === title);
              return { value: parseInt(value, 10), title, icon: meta && meta.icon };
            };
            return { out: card(match[1], match[2]), in: card(match[3], match[4]) };
          };
          const playerWithPrefix = suffix => orderedPlayers.find(p => action.startsWith(`${p.name}${suffix}`)) || null;
          const moonSource = playerWithPrefix(' 翻開【');
          const moonTitle = moonSource && /^([^】]+)】/.exec(action.slice(moonSource.name.length + ' 翻開【'.length));
          if (moonSource && moonTitle) {
            const mm = /(\d)\/3/.exec(String(resultText || ''));
            const ph = mm ? Math.min(3, Math.max(1, parseInt(mm[1], 10))) : 1;
            // 第 3 張月亮：場上有人手握狼人 ➔ 紅月之後直接播「咬向鏡頭」演出（較長）；狼人已被淘汰（面前有狼人牌）或無人手握 ➔ 沒有狼人
            let wolf = 'none', wolfWinner = null, traitorWinner = null;
            if (ph >= 3 && st && st.players) {
              st.players.filter(p => p.status === '存活').forEach(p => {
                const hand = ((st.playerHands || {})[p.id] || []).filter(Boolean);
                if (hand.some(c => c.title === '狼人')) wolfWinner = p;
                if (hand.some(c => c.title === '叛徒')) traitorWinner = p;
              });
              if (traitorWinner && wolfWinner && traitorWinner.id === wolfWinner.id) traitorWinner = null;
              const outW = st.players.some(p => playedCardsOf(p).some(c => c && c.title === '狼人'));
              wolf = wolfWinner ? 'held' : (outW ? 'out' : 'none');
              if (!wolfWinner) traitorWinner = null;
            }
            const dur = ph >= 3 ? (wolf === 'held' ? 6800 : 4200) : 3200;
            return { key: `${Date.now()}-${Math.random()}`, kind: 'moon', card: { title: moonTitle[1], value: '🌙', icon: 'fa-moon' }, src: moonSource, tgt: null, tone: 'ok', phase: ph, wolf, wolfWinner, traitorWinner, baseDur: dur, duration: dur };
          }
          // 第 3 張月亮翻開後，有人用拿一還一／守夜人把狼人留在手上 ➔ 直接播咬鏡頭演出
          const wolfSource = playerWithPrefix(' 手握【狼人】');
          if (wolfSource) {
            const wsrc = wolfSource;
            let wtraitor = null;
            players.filter(p => p.status === '存活' && p.id !== wsrc.id).forEach(p => {
              if (((st.playerHands || {})[p.id] || []).some(c => c && c.title === '叛徒')) wtraitor = p;
            });
            return { key: `${Date.now()}-${Math.random()}`, kind: 'wolfbite', card: { title: '狼人', value: 10, icon: 'fa-paw' }, src: wsrc, tgt: null, tone: 'ok', phase: 3, wolf: 'held', wolfWinner: wsrc, traitorWinner: wtraitor, baseDur: FX_DURATION.wolfbite, duration: FX_TOTAL_BY.wolfbite };
          }
          // 吸血鬼獲勝：動作行含「吸血鬼降臨」（出牌者打出吸血鬼，或賞金獵人公開了目標的吸血鬼）
          const vampireSource = action.includes('吸血鬼降臨') && orderedPlayers.find(p => action.startsWith(`${p.name} `));
          if (vampireSource) {
            const vsrc = vampireSource;
            if (vsrc) {
              const hi = playedCardsOf(vsrc).filter(c => c && c.value >= 7).map(c => ({ title: c.title, value: c.value }));
              return { key: `${Date.now()}-${Math.random()}`, kind: 'vampire', card: { title: '吸血鬼', value: 2, icon: 'fa-droplet' }, src: vsrc, tgt: null, tone: 'ok', highCards: hi, baseDur: FX_DURATION.vampire, duration: FX_TOTAL_BY.vampire };
            }
          }
          const servantSource = playerWithPrefix(' 棄掉面前【僕人】');
          if (servantSource) {
            const ssrc = servantSource;
            return { key: `${Date.now()}-${Math.random()}`, kind: 'servant', card: { title: '僕人', value: 1, icon: 'fa-bell-concierge' }, src: ssrc, tgt: null, tone: 'ok', baseDur: FX_DURATION.servant, duration: FX_TOTAL_BY.servant };
          }
          // 煉金術士：遭遇淘汰後棄掉面前煉金術士並復活（動畫排在淘汰動畫之後）
          const alchSource = orderedPlayers.find(p => action.startsWith(`${p.name} 遭遇淘汰`) || (action.startsWith(`${p.name} `) && /棄掉面前【煉金術士】/.test(res)));
          if (alchSource && /煉金術士/.test(String(res || '') + String(action || ''))) {
            return {
              key: `${Date.now()}-${Math.random()}`,
              kind: 'alchemist',
              card: { title: '煉金術士', value: 8, icon: 'fa-flask' },
              src: alchSource,
              tgt: null,
              tone: 'revive',
              stampText: '復活',
              stampTone: 'revive',
              baseDur: FX_DURATION.alchemist,
              duration: FX_TOTAL_BY.alchemist,
            };
          }
          const takeOneSource = playerWithPrefix(' 執行【拿一還一】');
          if (takeOneSource) {
            const sm = /暗牌\s*(\d)/.exec(res);
            const tsrc = takeOneSource;
            return { key: `${Date.now()}-${Math.random()}`, kind: 'takeone', card: { title: '拿一還一', value: '', icon: 'fa-right-left' }, src: tsrc, tgt: null, tone: 'ok', slot: sm ? parseInt(sm[1], 10) - 1 : null, baseDur: FX_DURATION.takeone, duration: FX_TOTAL };
          }
          const m = /打出了\((\d+)\)【([^】]+)】(.*)$/.exec(action);
          if (!m || !st || !players.length) return null;
          const prefix = action.slice(0, m.index).trim();
          const src = orderedPlayers.find(p => prefix === p.name || prefix.startsWith(`${p.name} 對 `)) || null;
          if (!src) return null;
          const targetPrefix = `${src.name} 對 `;
          const targetName = prefix.startsWith(targetPrefix) ? prefix.slice(targetPrefix.length) : '';
          const tgt = targetName === '自己' ? src : byName(targetName);
          const meta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === m[2]);
          if (!meta) return null;
          const tail = m[3] || '';
          const card = { title: meta.title, value: parseInt(m[1], 10), icon: meta.icon };

          let tone = 'ok';
          if (/無任何效果|沒有任何效果/.test(res)) tone = 'none';
          else if (/自我淘汰/.test(res)) tone = 'out';
          else if (/復活了/.test(res)) tone = 'revive';
          else if (/能力無效|能力失敗|無有效目標|無卡牌可選|無可奪取|不足|無法勝利/.test(res)) tone = 'nofx';
          else if (/反殺/.test(res)) tone = 'spy';
          else if (/平手/.test(res)) tone = 'tie';
          else if (/出局|淘汰/.test(res)) tone = 'out';
          else if (/失敗/.test(res)) tone = 'fail';

          let kind = FX_KIND[meta.title] || 'plain';
          // 無效果／能力落空／僕人 ➔ 牌放到面前的動畫
          if (tone === 'none' || tone === 'nofx' || meta.title === '僕人') kind = 'place';
          const needTgt = ['guess', 'ask', 'peek', 'bounty', 'grave'];
          if (needTgt.includes(kind) && !tgt) kind = 'plain';

          const fx = { key: `${Date.now()}-${Math.random()}`, kind, card, src, tgt, tone, noneText: meta.title === '僕人' ? '置於面前・待命' : '無效果' };

          if (kind === 'place') {
            const rm = /[（(]([^）)]+)[）)]/.exec(res);
            fx.lasting = ['僕人', '商人', '煉金術士'].includes(meta.title);
            if (meta.title === '僕人') fx.reason = '待命：可立即棄掉換額外回合';
            else if (PASSIVE_WHY[meta.title]) fx.reason = PASSIVE_WHY[meta.title];
            else if (meta.type === 'PASSIVE') fx.reason = '被動牌・結算時才啟動';
            else { fx.noEffect = true; fx.reason = rm ? rm[1] : res.replace(/^[➔\s]+/, '').replace(/^(沒有任何效果|無任何效果)[：:\s]*/, '').slice(0, 30); }
          }

          if (kind === 'guess') {
            const gm = /猜\((\d+)\)(?:與\((\d+)\))?/.exec(tail);
            fx.guesses = gm ? [gm[1], gm[2]].filter(v => v !== undefined) : [];
          } else if (kind === 'ask') {
            fx.question = meta.title === '稅務官' ? '0 或 1' : '9 或 10';
          } else if (kind === 'compare') {
            fx.mode = meta.title === '酒保' ? '比大' : '比小';
            if (tone === 'out') {
              const loser = orderedPlayers.find(p => [`${p.name}手牌`, `${p.name}的手牌`].some(marker => {
                const markerIndex = res.indexOf(marker);
                return markerIndex >= 0 && /^(?:\(\d+\))?較[小大]/.test(res.slice(markerIndex + marker.length));
              })) || null;
              if (!loser || !tgt || !src) kind = fx.kind = 'plain';
              else {
                fx.loserId = loser.id;
                // 輸家的牌依規則翻開放在面前（公開資訊）
                const lc = ((st.playerHands || {})[loser.id] || []).filter(Boolean)[0];
                if (lc) {
                  const lmeta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === lc.title);
                  fx.loserCard = { title: lc.title, value: lc.value, icon: (lmeta && lmeta.icon) || lc.icon };
                }
              }
            } else if ((tone !== 'tie' && !/平手/.test(res) && !res.includes('秘密比大小完成')) || !tgt || !src) kind = fx.kind = 'plain';
          } else if (kind === 'swap') {
            if (meta.title === '小偷') {
              fx.a = src; fx.b = tgt; fx.extraTurn = /額外回合/.test(res);
              const mine = parseMine(res);
              if (mine) fx.mine = mine;
              if (!fx.a || !fx.b) kind = fx.kind = 'plain';
            } else {
              let pair = null;
              for (const a of orderedPlayers) {
                for (const b of orderedPlayers) {
                  if (a.id !== b.id && res.includes(`秘密交換了 ${a.name} 與 ${b.name} 的手牌`)) {
                    pair = [a, b];
                    break;
                  }
                }
                if (pair) break;
              }
              fx.a = pair ? pair[0] : null; fx.b = pair ? pair[1] : null;
              if (!fx.a || !fx.b) kind = fx.kind = 'plain';
            }
          } else if (kind === 'drunk') {
            const sm = /（(.+?) 受保護未參與）/.exec(res);
            const skippedNames = sm ? sm[1].split('、') : [];
            fx.participants = players.filter(p => p.status === '存活' && !skippedNames.includes(p.name));
            fx.skipped = players.filter(p => skippedNames.includes(p.name));
            // 玩家自己洗入了哪張、拿到哪張；只有該玩家的私密動畫會帶入牌面。
            const minePlayer = orderedPlayers.find(p => res.includes(`${p.name} 換出 (`));
            const minePrefix = minePlayer ? `${minePlayer.name} 換出 (` : '';
            const mm = minePrefix ? /^\((\d+)\)【([^】]+)】、取得 \((\d+)\)【([^】]+)】/.exec(res.slice(res.indexOf(minePrefix) + minePrefix.length)) : null;
            if (mm) {
              const mk = (v, t) => { const mt = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === t); return { value: parseInt(v, 10), title: t, icon: mt && mt.icon }; };
              fx.mine = { out: mk(mm[1], mm[2]), in: mk(mm[3], mm[4]) };
            }
            if (!fx.participants.length) kind = fx.kind = 'plain';
          } else if (kind === 'bounty') {
            const bm = /\((\d+)\)【([^】]+)】/.exec(String(reveal || ''));
            if (bm) {
              const bmeta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === bm[2]);
              fx.revealed = { value: parseInt(bm[1], 10), title: bm[2], icon: bmeta && bmeta.icon };
            }
          } else if (kind === 'peek') {
            const pm = /手牌為\s*([^\s(（]+)[（(](\d+)[）)]/.exec(res)
              || /手牌為\s*\((\d+)\)【([^】]+)】/.exec(res);
            if (pm) {
              if (pm[2] && isNaN(parseInt(pm[1], 10))) {
                const title = pm[1];
                const value = parseInt(pm[2], 10);
                const pmeta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === title);
                fx.peeked = { value, title, icon: pmeta && pmeta.icon };
              } else if (pm[1] && pm[2]) {
                const value = parseInt(pm[1], 10);
                const title = pm[2];
                const pmeta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === title);
                fx.peeked = { value, title, icon: pmeta && pmeta.icon };
              }
            }
          } else if (kind === 'grave') {
            const gm = /面前\((\d+)\)【([^】]+)】/.exec(res);
            if (gm) {
              const gmeta = [...(window.BASE_CARDS_DEF || []), window.WEREWOLF_CARD].find(c => c.title === gm[2]);
              fx.stolen = { value: parseInt(gm[1], 10), title: gm[2], icon: gmeta && gmeta.icon };
            }
          } else if (kind === 'witch') {
            fx.tgt = orderedPlayers.find(p => res.includes(`復活了 ${p.name} ➔`)) || null;
            if (!fx.tgt) kind = fx.kind = 'plain';
          }

          // 章（淘汰／失敗…）：只有結果公開時才蓋；先知、守夜人、醉漢等秘密或無勝負的牌不蓋
          fx.stampText = tone === 'ok' ? null : (FX_STAMP_TEXT[tone] || null);
          if (tone === 'none') fx.stampText = null;
          fx.stampTone = tone;
          let elim = null;
          if (tone === 'spy') {
            const e1 = /反殺猜測者 (\S+?)！/.exec(res), e2 = /反殺！(\S+) 出局/.exec(res);
            elim = byName((e1 || e2 || [])[1]);
            if (elim && src && elim.id !== src.id && !fx.tgt) fx.tgt = elim;
          }
          if (kind === 'selfout' || tone === 'fail') fx.stampOn = 'src';
          else if (tone === 'spy') fx.stampOn = (elim && fx.tgt && elim.id === fx.tgt.id) ? 'tgt' : 'src';
          else fx.stampOn = 'tgt';
          fx.baseDur = FX_DURATION[kind] || 2200;
          fx.duration = kind === 'none' ? fx.baseDur : (FX_TOTAL_BY[kind] || FX_TOTAL);
          return fx;
        }

        // 最終比點數動畫：entries＝[{ p, card, base, mods:[{label}], final }]（座位順序）；
        // 由低到高逐一翻牌，最後兩位之間多停頓，再亮出勝者。時間單位＝秒（baseDur／duration 為毫秒）
        function buildScoreFx(entries, mode, winnerIds, winText) {
          const list = Array.isArray(entries) ? entries : [];
          const n = list.length;
          // 一般結算：由低到高翻牌；乞丐之王：先翻完所有手牌，最後才揭示「乞丐之王獲勝」
          const order = list.map((e, i) => ({ i, f: e.final })).sort((a, b) => a.f - b.f || a.i - b.i);
          const t0 = 1.3, step = 1.1;
          const rows = list.map((e, i) => {
            const k = order.findIndex(o => o.i === i);
            const t = t0 + k * step + (n > 1 && k === n - 1 ? 0.9 : 0);
            return { ...e, t, win: mode === 'beggar' ? false : (winnerIds || []).includes(e.p && e.p.id), winLate: (winnerIds || []).includes(e.p && e.p.id) };
          });
          const tLast = Math.max(...rows.map(r => r.t), t0);
          const anyMods = rows.some(r => r.mods && r.mods.length);
          const tWin = mode === 'beggar' ? tLast + (anyMods ? 2.4 : 2.0) : tLast + (anyMods ? 1.7 : 1.0);
          const holdEnd = mode === 'beggar' ? 2.6 : 1.8;
          const total = Math.round((tWin + holdEnd) * 1000);
          return {
            key: `${Date.now()}-${Math.random()}`, kind: 'score', mode, rows, tWin, winText,
            winnerIds: winnerIds || [],
            maxV: Math.max(12, ...rows.map(r => r.final)),
            card: null, src: null, tgt: null, tone: 'ok', baseDur: total, duration: total,
          };
        }

        function Avatar({ p, size = 'w-11 h-11', glow = '' }) {
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
        function FxChip({ p, size = 'w-11 h-11 text-xl', dim = false, glow = '' }) {
          const localPlayerId = React.useContext(window.LocalPlayerContext);
          if (!p) return null;
          return (
            <div className={`flex flex-col items-center gap-0.5 ${dim ? 'opacity-40' : ''}`}>
              <Avatar p={p} size={size} glow={glow} />
              <span className={`text-[10px] leading-none font-black whitespace-nowrap ${p.id === localPlayerId ? 'text-sky-300' : 'text-slate-100'}`}>{p.name}</span>
            </div>
          );
        }
        function FxBack({ cls = 'w-11 h-[60px]', label = '', moonCls = 'text-xs' }) {
          return (
            <div className={`${cls} rounded-md border-2 border-amber-500/70 bg-gradient-to-br from-indigo-900 to-slate-800 flex flex-col items-center justify-center gap-0.5 shadow`}>
              <i className={`fa-solid fa-moon text-amber-400/80 ${moonCls}`}></i>
              {label && <span className="text-[10px] font-black text-slate-300 leading-none">{label}</span>}
            </div>
          );
        }
        // 玩家自己的換牌：換出什麼、換入什麼（swap／takeone／drunk 共用）
        function FxMine({ mine, delay = 2, out = '你換出', inn = '你換入' }) {
          if (!mine) return null;
          return (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-400/70 bg-slate-950/70 px-2 py-1" style={{ animation: `fxPop .4s ease ${delay}s both` }}>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] font-black text-sky-300">{out}</span>
                <FxFace c={mine.out} cls="w-12 h-[60px]" />
              </div>
              <i className="fa-solid fa-arrow-right text-amber-400 text-sm"></i>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] font-black text-emerald-300">{inn}</span>
                <FxFace c={mine.in} cls="w-12 h-[60px]" />
              </div>
            </div>
          );
        }
        function FxFace({ c, cls = 'w-11 h-[60px]' }) {
          if (!c) return <FxBack cls={cls} />;
          return (
            <div className={`${cls} shrink-0 overflow-hidden rounded-md border-2 border-amber-400 bg-slate-900 flex flex-col items-center justify-center shadow-lg`}>
              <span className="font-mono font-black text-amber-300 text-base leading-none">{c.value}</span>
              <i className={`fa-solid ${c.icon || 'fa-circle'} text-amber-400/80 text-sm my-0.5`}></i>
              <span className="text-[9px] font-black text-amber-200 leading-none whitespace-nowrap">{c.title}</span>
            </div>
          );
        }
        // 最終比點數用的精簡牌面：只有數值與牌名（不放中間圖案），避免字太大放不下
        function FxFaceMini({ c, cls = 'w-10 h-[44px]' }) {
          if (!c) return <FxBack cls={cls} />;
          return (
            <div className={`${cls} shrink-0 overflow-hidden rounded-md border-2 border-amber-400 bg-slate-900 flex flex-col items-center justify-center shadow-lg`}>
              <span className="font-mono font-black text-amber-300 text-sm leading-none">{c.value}</span>
              <span className="text-[8px] font-black text-amber-200 leading-none whitespace-nowrap mt-1 tracking-tighter">{c.title}</span>
            </div>
          );
        }
        function FxStamp({ tone, text, delay = 1.5 }) {
          if (!text) return null;
          return (
            <div
              className={`absolute left-1/2 top-1/2 z-10 px-2 py-0.5 border-[3px] rounded-md font-black text-base tracking-widest whitespace-nowrap bg-slate-950/70 pointer-events-none ${FX_STAMP_CLS[tone] || FX_STAMP_CLS.ok}`}
              style={{ animation: `fxStamp .35s ease-out ${delay}s both` }}
            >{text}</div>
          );
        }

        function FxOverlay({ fx, onSkip, replay, localPlayerId = 0 }) {
          const { kind, card, src, tgt } = fx;
          const full = kind === 'moon' || kind === 'wolfbite' || kind === 'vampire' || kind === 'score' || kind === 'match';
          
          // 若是全屏動畫，我們希望它能蓋過整個畫面（包含 A 區頂部），因此使用 fixed 絕對定位與最高 z-index
          const fullStyle = full ? "fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center pointer-events-auto" : "absolute inset-0 z-40 flex items-center justify-center pointer-events-none";

          // 全屏（含最終結算）：對局中播完前不可略過；播完後與其他動畫一樣要點一下才關。回放可隨時離開。
          const [canDismiss, setCanDismiss] = React.useState(!!replay || !full);
          const bodyRef = React.useRef(null);
          const slotRef = React.useRef(null), stolenRef = React.useRef(null), tgtRef = React.useRef(null);
          React.useEffect(() => {
            if (replay || !full) {
              setCanDismiss(true);
              return;
            }
            setCanDismiss(false);
            const t = setTimeout(() => setCanDismiss(true), Math.max(0, fx.duration || 0));
            return () => clearTimeout(t);
          }, [fx.key, fx.duration, full, replay]);
          React.useEffect(() => {
            // 終局動畫（比點／狼月／吸血鬼／第3月亮）：不自動關閉，只能播完後點擊繼續
            const isFinaleFx = fx.kind === 'score' || fx.kind === 'wolfbite' || fx.kind === 'vampire' || fx.kind === 'match'
              || (fx.kind === 'moon' && (Number(fx.phase) >= 3 || fx.wolf === 'held'));
            if (replay || isFinaleFx) return;
            // 安全網：一般動畫若一直不點，duration+15s 後強制關閉，避免永久卡死
            const recoveryTimer = setTimeout(onSkip, Math.max(0, fx.duration || 0) + 15000);
            return () => clearTimeout(recoveryTimer);
          }, []);
          const handleClick = () => {
            if (full && !replay && !canDismiss) return;
            onSkip();
          };
          // 掘墓人：量出「目標頭像」到「出牌者左邊空位」的距離，讓奪取的牌從目標那邊滑過來
          React.useLayoutEffect(() => {
            const sl = slotRef.current, tg = tgtRef.current, el = stolenRef.current;
            if (!sl || !tg || !el) return;
            const dx = (tg.offsetLeft + tg.offsetWidth / 2) - (sl.offsetLeft + sl.offsetWidth / 2);
            const dy = (tg.offsetTop + tg.offsetHeight / 2) - (sl.offsetTop + sl.offsetHeight / 2);
            el.style.setProperty('--dx', `${dx}px`);
            el.style.setProperty('--dy', `${dy}px`);
          }, []);
          React.useLayoutEffect(() => {
            const r = (fx.baseDur || fx.duration || 1) / (fx.duration || 1);
            if (r === 1 || !bodyRef.current || !bodyRef.current.getAnimations) return;
            bodyRef.current.getAnimations({ subtree: true }).forEach(a => { try { a.updatePlaybackRate(r); } catch (e) {} });
          }, []);
          const an = (name, dur, delay, ease = 'cubic-bezier(.2,.9,.3,1.15)') => ({ animation: `${name} ${dur}s ${ease} ${delay}s both` });
          const stamp = (delay) => <FxStamp tone={fx.stampTone} text={fx.stampText} delay={delay} />;
          const isNone = kind === 'none';
          let revealAt = 2.2; // 淘汰者公開手牌出現的時間（在「淘汰」章之後）
          let body = null;

          if (kind === 'none') {
            body = (
              <div className="px-3 py-1 rounded-full bg-slate-800/90 border border-slate-600 text-slate-300 text-[11px] font-black shadow-lg">
                <span className="font-mono text-amber-300 mr-1">{card.value}</span>{card.title}｜{fx.noneText}
              </div>
            );
          } else if (kind === 'place') {
            // 牌打出後，縮小滑到頭像下邊的「面前」位置
            body = (
              <div className="flex flex-col items-center gap-1.5">
                <div className="relative w-[200px] h-[144px]">
                  <div className="absolute left-[36px] top-0" style={an('fxInL', 0.4, 0)}><FxChip p={src} size="w-14 h-14 text-2xl" /></div>
                  <div className="absolute left-[44px] top-[86px] w-[40px] h-[54px] rounded-md border-2 border-dashed border-slate-500/70 flex items-end justify-center" style={an('fxFadeUp', 0.4, 0.5)}>
                    <span className="text-[8px] text-slate-500 mb-0.5">面前</span>
                  </div>
                  <div className="absolute left-[120px] top-0 z-10" style={an('fxPop', 0.4, 0.15)}>
                    <div style={an('fxToFront', 0.7, 1.0, 'ease-in-out')}><FxFace c={card} cls="w-14 h-[76px]" /></div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-500/70 text-slate-200 text-[10px] font-black" style={an('fxPop', 0.3, 1.8)}>
                    <i className="fa-solid fa-layer-group mr-1"></i>置於面前
                  </span>
                  {fx.lasting && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-900/70 border border-emerald-500/60 text-emerald-200 text-[10px] font-black" style={an('fxPop', 0.3, 2.0)}>
                      <i className="fa-solid fa-bolt mr-1"></i>生效中
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-black text-center px-2 text-rose-300" style={an('fxFadeUp', 0.4, 2.2)}>
                  沒有任何效果{fx.reason ? `（${fx.reason}）` : ''}
                </div>
              </div>
            );
          } else if (kind === 'servant') {
            // 棄掉面前的僕人 ➔ 額外回合
            body = (
              <div className="flex flex-col items-center gap-1.5">
                <div className="relative w-[200px] h-[144px]">
                  <div className="absolute left-[36px] top-0" style={an('fxInL', 0.4, 0)}><FxChip p={src} size="w-14 h-14 text-2xl" /></div>
                  <div className="absolute left-[44px] top-[86px] w-[40px] h-[54px] rounded-md border-2 border-dashed border-slate-500/70 flex items-end justify-center" style={an('fxFadeUp', 0.4, 0.3)}>
                    <span className="text-[8px] text-slate-500 mb-0.5">面前</span>
                  </div>
                  <div className="absolute left-[36px] top-[75px] z-10" style={{ transform: 'scale(.65)' }}>
                    <div style={an('fxPop', 0.4, 0.2)}>
                      <div style={an('fxDiscard', 0.7, 1.1, 'ease-in')}><FxFace c={card} cls="w-14 h-[76px]" /></div>
                    </div>
                  </div>
                  <span className="absolute left-[96px] top-[100px] px-1.5 py-0.5 rounded-full bg-emerald-900/70 border border-emerald-500/60 text-emerald-200 text-[9px] font-black" style={{ animation: 'fxFadeUp .3s ease .5s both, fxOut .3s ease 1.1s forwards' }}>生效中</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-500/70 text-slate-200 text-[10px] font-black" style={an('fxPop', 0.3, 1.8)}>
                    <i className="fa-solid fa-trash-can mr-1"></i>棄掉【僕人】
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-900/70 border border-emerald-500/60 text-emerald-200 text-[10px] font-black" style={an('fxPop', 0.3, 2.0)}>
                    <i className="fa-solid fa-forward mr-1"></i>額外回合
                  </span>
                </div>
              </div>
            );
          } else if (kind === 'alchemist') {
            // 棄掉面前煉金術士 ➔ 復活（排在淘汰動畫之後播）
            body = (
              <div className="flex flex-col items-center gap-1.5">
                <div className="relative w-[220px] h-[150px]">
                  <div className="absolute left-[40px] top-0" style={an('fxInL', 0.4, 0)}>
                    <FxChip p={src} size="w-14 h-14 text-2xl" glow="ring-4 ring-emerald-400/70" />
                  </div>
                  <div className="absolute left-[48px] top-[90px] w-[40px] h-[54px] rounded-md border-2 border-dashed border-slate-500/70 flex items-end justify-center" style={an('fxFadeUp', 0.4, 0.25)}>
                    <span className="text-[8px] text-slate-500 mb-0.5">面前</span>
                  </div>
                  <div className="absolute left-[40px] top-[78px] z-10" style={{ transform: 'scale(.65)' }}>
                    <div style={an('fxPop', 0.35, 0.2)}>
                      <div style={an('fxDiscard', 0.7, 1.0, 'ease-in')}><FxFace c={card} cls="w-14 h-[76px]" /></div>
                    </div>
                  </div>
                  <span className="absolute left-[100px] top-[102px] px-1.5 py-0.5 rounded-full bg-rose-900/70 border border-rose-500/50 text-rose-200 text-[9px] font-black" style={{ animation: 'fxFadeUp .3s ease .4s both, fxOut .3s ease 1.05s forwards' }}>生效中</span>
                  {stamp(2.0)}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-500/70 text-slate-200 text-[10px] font-black" style={an('fxPop', 0.3, 1.7)}>
                    <i className="fa-solid fa-flask mr-1 text-amber-300"></i>棄掉【煉金術士】
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-900/70 border border-emerald-500/60 text-emerald-200 text-[10px] font-black" style={an('fxPop', 0.3, 2.0)}>
                    <i className="fa-solid fa-heart-pulse mr-1"></i>抽牌復活
                  </span>
                </div>
                <div className="text-[10px] font-black text-emerald-300 text-center" style={an('fxFadeUp', 0.35, 2.2)}>
                  死裡逃生！繼續存活
                </div>
              </div>
            );
          } else if (kind === 'moon' || kind === 'wolfbite' || kind === 'vampire') {
            // 月亮升起／狼人勝利／吸血鬼勝利：動畫已獨立到 finale.js
            body = typeof window.FinaleFx === 'function' ? <window.FinaleFx fx={fx} src={src} card={card} localPlayerId={localPlayerId} an={an} /> : null;
          } else if (kind === 'score') {
            // 牌庫耗盡：全屏由低到高逐一翻牌算點數，最後亮出勝者（播完前不可略過）
            const tWin = fx.tWin;
            body = (
              <div className="w-[min(340px,92vw)] max-w-full flex flex-col gap-1.5 px-1">
                <div className="text-center mb-1" style={an('fxFadeUp', 0.4, 0)}>
                  <div className="text-sm font-black text-amber-200 tracking-widest"><i className="fa-solid fa-hourglass-end mr-1"></i>牌庫耗盡・{fx.mode === 'beggar' ? '乞丐之王檢定' : '最終結算'}</div>
                </div>
                {(fx.rows || []).map((r, k) => {
                  const hasM = r.mods && r.mods.length > 0;
                  const dBase = r.t + 0.3;
                  const dFinal = hasM ? r.t + 1.0 : r.t + 0.3;
                  const pct = Math.max(4, Math.round(r.final / fx.maxV * 100));
                  return (
                    <div key={r.p.id} style={an('fxPop', 0.35, 0.2 + k * 0.08)}>
                      <div className="relative flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg bg-slate-900/70 border border-slate-700/60" style={(r.win || (fx.mode === 'beggar' && r.winLate)) ? { animation: `fxWinGlow .6s ease-out ${tWin}s both` } : (fx.mode === 'beggar' ? { animation: `fxDim .5s linear ${tWin + 0.35}s both` } : { animation: `fxDim .5s linear ${tWin}s both` })}>
                        <Avatar p={r.p} size="w-6 h-6 text-xs" />
                        <span className={`w-12 truncate text-[10px] font-black ${r.p.id === localPlayerId ? 'text-sky-300' : 'text-slate-100'}`}>{r.p.name}</span>
                        <div className="relative w-10 h-[44px] shrink-0">
                          <div className="absolute inset-0" style={an('fxFlipOut', 0.2, r.t - 0.05, 'ease-in')}><FxBack cls="w-10 h-[44px]" /></div>
                          <div className="absolute inset-0" style={an('fxFlipIn', 0.3, r.t + 0.1, 'ease-out')}><FxFaceMini c={r.card} cls="w-10 h-[44px]" /></div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="h-2.5 rounded bg-slate-800 overflow-hidden">
                            <div className="h-full rounded bg-gradient-to-r from-sky-500 to-cyan-300" style={{ '--w': `${pct}%`, animation: `fxBarGrow .6s ease-out ${dFinal}s both` }}></div>
                          </div>
                          <div className="min-h-[12px] mt-0.5 flex flex-wrap gap-1">
                            {hasM && r.mods.map((m, mi) => <span key={mi} className="text-[8px] font-black px-1 rounded bg-fuchsia-900/70 border border-fuchsia-500/50 text-fuchsia-200" style={an('fxPop', 0.3, r.t + 0.6)}>{m.label}</span>)}
                          </div>
                        </div>
                        <div className="relative w-9 h-6 shrink-0 font-mono font-black text-lg text-amber-300">
                          <span className="absolute inset-0 flex items-center justify-end" style={hasM ? { animation: `fxPop .3s ease-out ${dBase}s both, fxOut .2s linear ${r.t + 0.95}s forwards` } : an('fxPop', 0.3, dBase)}>{r.base}</span>
                          {hasM && <span className="absolute inset-0 flex items-center justify-end" style={an('fxPop', 0.35, r.t + 1.0)}>{r.final}</span>}
                        </div>
                        {(r.win || (fx.mode === 'beggar' && r.winLate)) && (
                          <span className="absolute -top-2 -right-1 text-sm" style={an('fxPop', 0.4, tWin + 0.15)}>👑</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {fx.mode === 'beggar' && (
                  <div className="mt-2 flex flex-col items-center gap-1" style={an('fxPop', 0.45, tWin)}>
                    <div
                      className="px-3 py-1 rounded-md border-[3px] border-amber-400 text-amber-300 font-black text-base tracking-widest bg-slate-950/80"
                      style={an('fxStamp', 0.4, tWin)}
                    >乞丐之王發動</div>
                    <div className="text-[10px] text-slate-400 font-bold" style={an('fxFadeUp', 0.35, tWin + 0.25)}>最終點數作廢・獨享勝利</div>
                  </div>
                )}
                <div className="mt-1 text-center text-sm font-black text-amber-300" style={an('fxPop', 0.5, tWin + (fx.mode === 'beggar' ? 0.55 : 0.2))}>{fx.winText}</div>
              </div>
            );
          } else if (kind === 'match') {
            const winners = Array.isArray(fx.matchWinners) ? fx.matchWinners : [];
            const need = fx.winsNeeded || 2;
            body = (
              <div className="w-[min(360px,94vw)] flex flex-col items-center gap-3 px-2">
                <div className="relative w-28 h-28 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-2 border-amber-400/50" style={an('matchRing', 2.2, 0.2, 'ease-out')}></div>
                  <div className="absolute inset-[-10px] rounded-full border border-amber-300/20" style={an('matchBurst', 1.6, 1.2, 'ease-out')}></div>
                  <i className="fa-solid fa-crown text-5xl text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,.9)]" style={an('matchCrownDrop', 0.7, 0.15)}></i>
                </div>
                <div className="text-center" style={an('matchTitleIn', 0.8, 0.5)}>
                  <div className="text-[11px] font-black text-amber-200/90 tracking-widest mb-1">月亮標記集滿</div>
                  <div className="text-xl font-black text-amber-300 tracking-wide">贏得整場</div>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {Array.from({ length: need }).map((_, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-slate-900 border-2 border-amber-400 text-amber-300 text-xl shadow-[0_0_14px_rgba(251,191,36,.55)]"
                      style={{ animation: `matchMoonIn .55s cubic-bezier(.2,.9,.3,1.2) ${0.9 + i * 0.35}s both` }}
                    >
                      <i className="fa-solid fa-moon"></i>
                    </span>
                  ))}
                </div>
                <div className="w-full flex flex-col items-center gap-2 mt-1" style={an('fxFadeUp', 0.45, 1.6 + need * 0.15)}>
                  {winners.map((w, wi) => (
                    <div key={wi} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/50">
                      {w.p && <Avatar p={w.p} size="w-9 h-9 text-base" glow="shadow-[0_0_12px_rgba(251,191,36,.7)]" />}
                      <div className="text-left">
                        <div className="text-sm font-black text-amber-200">{w.name}</div>
                        <div className="text-[10px] font-bold text-amber-400/90"><i className="fa-solid fa-moon mr-0.5"></i>×{need} 勝場月亮</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] font-black text-slate-300 tracking-wide mt-1" style={an('fxPop', 0.4, 2.4 + need * 0.1)}>
                  新的一場即將開始・月亮標記將重置
                </div>
              </div>
            );
          } else if (kind === 'takeone') {
            const selectedSlot = Number.isInteger(fx.slot);
            body = (
              <div className="flex flex-col items-center gap-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-200" style={an('fxPop', 0.4, 0)}>
                  <i className="fa-solid fa-right-left"></i>拿一還一{selectedSlot ? `｜暗牌 ${fx.slot + 1}` : ''}
                </div>
                <div className="flex items-center gap-3">
                  <div style={an('fxInL', 0.4, 0.1)}><FxChip p={src} /></div>
                  <div className="relative flex gap-2">
                    {[0, 1, 2].map(i => {
                      const active = selectedSlot && i === fx.slot;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1" style={active ? { animation: 'fxTakeSlot 1.6s ease-in-out .55s both' } : an('fxPop', 0.3, 0.2 + i * 0.1)}>
                          <div className={active ? 'drop-shadow-[0_0_10px_#fbbf24] ring-2 ring-amber-400/80 rounded-md' : ''}>
                            <FxBack cls="w-10 h-[54px]" />
                          </div>
                          <span className={`text-[9px] font-black ${active ? 'text-amber-300' : 'text-slate-500'}`}>暗牌{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5" style={an('fxFadeUp', 0.35, 0.45)}>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-500/70 text-slate-200 text-[10px] font-black">拿起</span>
                  <i className="fa-solid fa-arrow-right text-amber-400 text-[10px]"></i>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-amber-500/50 text-amber-200 text-[10px] font-black">放回同一格</span>
                </div>
                <div className="text-[9px] text-slate-400" style={an('fxFadeUp', 0.4, 0.7)}>中央暗牌維持 3 張（牌面不公開）</div>
                <FxMine mine={fx.mine} delay={2.0} />
              </div>
            );
          } else if (kind === 'compare') {
            // 第一拍：誰 對 誰 打出什麼牌；第二拍（T 秒後）：開始比大小
            const T = 1.7;
            const K = 2; // 第二拍（開始比大小）放慢到 0.5x：動畫長度與延遲都乘 2
            const a2 = (name, dur, d, ease) => an(name, dur * K, T + d * K, ease);
            const loserSide = fx.loserId === undefined ? null : (src && fx.loserId === src.id ? 'L' : 'R');
            const col = (p, side) => {
              const isLoser = loserSide === side;
              const inner = isLoser
                ? a2(side === 'L' ? 'fxKnockL' : 'fxKnockR', 0.5, 1.35, 'ease-out')
                : a2('fxShake', 0.5, 1.35);
              return (
                <div className="flex flex-col items-center gap-1.5" style={a2(side === 'L' ? 'fxClashL' : 'fxClashR', 0.6, 0.5, 'cubic-bezier(.3,1.4,.5,1)')}>
                  <FxChip p={p} />
                  <div style={inner}>
                    <div className="relative w-14 h-[76px]">
                      <div className="absolute inset-0" style={isLoser ? a2('fxFlipOut', 0.2, 1.5, 'ease-in') : undefined}><FxBack cls="w-14 h-[76px]" /></div>
                      {isLoser && fx.loserCard && (
                        <div className="absolute inset-0" style={a2('fxFlipIn', 0.25, 1.7, 'ease-out')}><FxFace c={fx.loserCard} cls="w-14 h-[76px]" /></div>
                      )}
                      {isLoser && stamp(T + 2.0 * K)}
                    </div>
                  </div>
                </div>
              );
            };
            body = (
              <div className="grid place-items-center">
                <div className="col-start-1 row-start-1 flex flex-col items-center gap-2.5" style={an('fxOut', 0.3, T - 0.3, 'ease-in')}>
                  <div className="flex items-center justify-center gap-2.5">
                    <div style={an('fxInL', 0.4, 0)}><FxChip p={src} /></div>
                    <div style={an('fxPop', 0.4, 0.15)}><FxFace c={card} cls="w-14 h-[76px]" /></div>
                    <i className="fa-solid fa-arrow-right text-amber-400 text-sm" style={an('fxFadeUp', 0.3, 0.5)}></i>
                    <div style={an('fxInR', 0.4, 0.6)}><FxChip p={tgt} /></div>
                  </div>
                  <div className="text-[11px] font-black text-amber-200" style={an('fxFadeUp', 0.4, 0.95)}>秘密比較手牌・{fx.mode}</div>
                </div>
                <div className="col-start-1 row-start-1 flex flex-col items-center gap-2">
                  <div className="flex items-center gap-1.5" style={a2('fxPop', 0.4, 0)}>
                    <FxFace c={card} cls="w-12 h-[64px]" />
                    <span className="text-amber-300 font-black text-sm whitespace-nowrap">{fx.mode}</span>
                  </div>
                  <div className="relative flex items-center justify-center gap-3">
                    {col(src, 'L')}
                    <span className="text-white font-black text-lg" style={a2('fxPop', 0.3, 0.3)}>VS</span>
                    {col(tgt, 'R')}
                    {fx.tone === 'tie' && stamp(T + 1.5 * K)}
                  </div>
                </div>
              </div>
            );
          } else if (kind === 'swap') {
            // 上方：一律蓋牌交叉交換；下方：僅參與者顯示換出／換入（優先依本機玩家從 swapMeta 解析）
            let mine = null;
            if (fx.swapMeta && Array.isArray(fx.swapMeta.parties)) {
              const me = fx.swapMeta.parties.find(p => p.id === localPlayerId);
              if (me && me.out && me.in) mine = { out: me.out, in: me.in };
            } else if (fx.mine) {
              mine = fx.mine;
            }
            body = (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-200" style={an('fxPop', 0.4, 0)}>
                  {card.title === '扒手' && <FxChip p={src} size="w-7 h-7 text-sm" />}
                  <span><span className="font-mono text-amber-300">{card.value}</span> {card.title}</span>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <div style={an('fxInL', 0.4, 0.1)}><FxChip p={fx.a} /></div>
                  <div className="relative w-[100px] h-[78px]">
                    <div className="absolute left-1/2 top-1/2 -ml-[20px] -mt-[28px]" style={{ animation: 'fxCrossA 1.1s ease-in-out .7s both' }}>
                      <FxBack cls="w-8 h-11" />
                    </div>
                    <div className="absolute left-1/2 top-1/2 -ml-[20px] -mt-[28px]" style={{ animation: 'fxCrossB 1.1s ease-in-out .7s both' }}>
                      <FxBack cls="w-8 h-11" />
                    </div>
                    {stamp(1.9)}
                  </div>
                  <div style={an('fxInR', 0.4, 0.1)}><FxChip p={fx.b} /></div>
                </div>
                <FxMine mine={mine} delay={1.9} />
                {fx.extraTurn && (
                  <div className="px-2 py-0.5 rounded-full bg-emerald-900/70 border border-emerald-500/60 text-emerald-200 text-[10px] font-black" style={an('fxFadeUp', 0.4, 1.9)}>獲得額外回合</div>
                )}
              </div>
            );
          } else if (kind === 'drunk') {
            const ids = fx.participants || [];
            const n = ids.length;
            const pos = (i) => {
              const a = (-90 + (360 / n) * i) * Math.PI / 180;
              return { x: Math.round(Math.cos(a) * 88), y: Math.round(Math.sin(a) * 60) };
            };
            // 優先依本機玩家從 drunkMeta 解析換出／換入，避免線上同步時全員看到出牌者的牌面
            let drunkMine = null;
            if (fx.drunkMeta && Array.isArray(fx.drunkMeta.parties)) {
              const me = fx.drunkMeta.parties.find(p => p.id === localPlayerId);
              if (me && (me.out || me.in)) drunkMine = { out: me.out, in: me.in };
            } else if (fx.mine) {
              drunkMine = fx.mine;
            }
            body = (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-200" style={an('fxPop', 0.4, 0)}>
                  <FxChip p={src} size="w-6 h-6 text-xs" />
                  <span><span className="font-mono text-amber-300">{card.value}</span> {card.title}｜全員手牌洗勻重發</span>
                </div>
                <div className="relative w-[240px] h-[160px]">
                  {ids.map((p, i) => {
                    const { x, y } = pos(i);
                    return (
                      <div key={`c${p.id}`} className="absolute inset-0 flex items-center justify-center">
                        <div style={{ transform: `translate(${x}px, ${y}px)`, animation: `fxFlash .6s ease-in-out 2.3s both` }}>
                          <FxChip p={p} size="w-9 h-9 text-base" />
                        </div>
                      </div>
                    );
                  })}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div style={an('fxShuffle', 0.9, 0.75, 'ease-in-out')}>
                      <div className="relative w-9 h-12">
                        <div className="absolute -left-1 -top-1"><FxBack cls="w-9 h-12" /></div>
                        <div className="absolute left-0 top-0"><FxBack cls="w-9 h-12" /></div>
                      </div>
                    </div>
                  </div>
                  {ids.map((p, i) => {
                    const { x, y } = pos(i);
                    return (
                      <div key={`k${p.id}`} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div style={{ '--x': `${x}px`, '--y': `${y}px`, animation: `fxDrunkCard 2.5s ease-in-out ${0.15 + i * 0.07}s both` }}>
                          <FxBack cls="w-6 h-8" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <FxMine mine={drunkMine} delay={2.9} />
                {fx.skipped && fx.skipped.length > 0 && (
                  <div className="text-[9px] font-bold text-cyan-300" style={an('fxFadeUp', 0.4, 0.5)}><i className="fa-solid fa-shield-halved mr-1"></i>{fx.skipped.map(p => p.name).join('、')} 受保護未參與</div>
                )}
              </div>
            );
          } else if (kind === 'watch') {
            body = (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5" style={an('fxPop', 0.4, 0)}>
                  <FxChip p={src} />
                  <span className="text-[10px] font-black text-amber-200"><span className="font-mono text-amber-300">{card.value}</span> {card.title}｜調整中央暗牌</span>
                </div>
                <div className="relative w-[170px] h-[92px]">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="absolute left-1/2 top-1/2 -ml-[22px] -mt-[30px]"
                      style={{ '--a': `${(i - 1) * 54}px`, '--b': `${(((i + 1) % 3) - 1) * 54}px`, '--r': `${(i - 1) * 9}deg`, animation: `fxSlot 2.0s ease-in-out ${0.3 + i * 0.05}s both` }}>
                      <FxBack />
                    </div>
                  ))}
                </div>
              </div>
            );
          } else if (kind === 'shield') {
            body = (
              <div className="flex flex-col items-center gap-2">
                <div className="relative" style={an('fxPop', 0.4, 0)}>
                  <FxChip p={src} size="w-14 h-14 text-2xl" glow="ring-4 ring-cyan-400/70" />
                  <i className="fa-solid fa-shield-halved absolute -right-4 -top-2 text-3xl text-cyan-300 drop-shadow" style={an('fxPop', 0.4, 0.5)}></i>
                </div>
                <div className="text-[11px] font-black text-cyan-200" style={an('fxFadeUp', 0.4, 0.9)}><span className="font-mono text-amber-300">{card.value}</span> {card.title}｜受保護至下個回合</div>
              </div>
            );
          } else if (kind === 'peek') {
            body = (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-200" style={an('fxPop', 0.4, 0)}>
                  <span><span className="font-mono text-amber-300">{card.value}</span> {card.title}</span>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <div style={an('fxInL', 0.4, 0.1)}><FxChip p={src} /></div>
                  <div className="flex flex-col items-center gap-0.5" style={an('fxPop', 0.4, 0.3)}>
                    <i className="fa-solid fa-eye text-sky-300 text-xl drop-shadow" style={an('fxFlash', 0.8, 0.7)}></i>
                    <span className="text-[9px] font-black text-sky-200">秘密檢視</span>
                  </div>
                  <div style={an('fxInR', 0.4, 0.1)}><FxChip p={tgt} /></div>
                </div>
                {fx.peeked ? (
                  <div className="flex flex-col items-center gap-1 mt-1" style={an('fxPop', 0.4, 1.4)}>
                    <span className="text-[10px] font-black text-sky-300"><i className="fa-solid fa-lock mr-0.5"></i>你看到的手牌</span>
                    <FxFace c={fx.peeked} cls="w-14 h-[76px]" />
                  </div>
                ) : (
                  <div className="px-2.5 py-1 rounded-lg bg-slate-800 border border-sky-500/50 text-sky-200 font-black text-[10px]" style={an('fxFadeUp', 0.35, 1.2)}>
                    <i className="fa-solid fa-eye mr-1"></i>秘密檢視完成
                  </div>
                )}
              </div>
            );
          } else if (kind === 'grave') {
            const graveSelf = !!(tgt && src && tgt.id === src.id);
            body = (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-200" style={an('fxPop', 0.4, 0)}>
                  <span><span className="font-mono text-amber-300">{card.value}</span> {card.title}</span>
                </div>
                <div className="relative flex items-center justify-center gap-2">
                  <div ref={slotRef} className="relative w-14 h-[76px] shrink-0">
                    {fx.stolen && (
                      <div ref={stolenRef} className="absolute inset-0 z-20" style={{ animation: 'fxGraveMove 1.6s ease-in-out .85s both' }}>
                        <div className="absolute inset-0" style={an('fxFlipOut', 0.2, 1.0, 'ease-in')}><FxBack cls="w-14 h-[76px]" /></div>
                        <div className="absolute inset-0" style={an('fxFlipIn', 0.25, 1.2, 'ease-out')}><FxFace c={fx.stolen} cls="w-14 h-[76px]" /></div>
                      </div>
                    )}
                    {!fx.stolen && <div className="w-14 h-[76px] rounded-md border-2 border-dashed border-slate-600/60" />}
                    <span className="absolute left-0 right-0 top-full mt-1 text-center text-[9px] font-black text-amber-200" style={an('fxFadeUp', 0.3, 2.5)}>奪取</span>
                  </div>
                  <div style={an('fxInL', 0.4, 0)}><FxChip p={src} /></div>
                  <div style={an('fxPop', 0.4, 0.15)}><FxFace c={card} cls="w-12 h-[66px]" /></div>
                  {tgt && !graveSelf && (
                    <>
                      <i className="fa-solid fa-arrow-right text-amber-400 text-sm" style={an('fxFadeUp', 0.3, 0.4)}></i>
                      <div ref={tgtRef} className="relative" style={an('fxInR', 0.4, 0.5)}>
                        <FxChip p={tgt} />
                        {fx.stolen && (
                          <div className="absolute left-full ml-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={an('fxOut', 0.35, 0.95, 'ease-in')}>
                            <FxFace c={fx.stolen} cls="w-10 h-[54px]" />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {graveSelf && (
                    <>
                      <span className="text-[10px] font-black text-slate-300" style={an('fxFadeUp', 0.3, 0.5)}>對自己</span>
                      <div ref={tgtRef} className="relative w-10 h-[54px] shrink-0" style={an('fxInR', 0.4, 0.5)}>
                        {fx.stolen && (
                          <div className="absolute inset-0 pointer-events-none" style={an('fxOut', 0.35, 0.95, 'ease-in')}>
                            <FxFace c={fx.stolen} cls="w-10 h-[54px]" />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {fx.stolen && (
                  <div className="text-[10px] font-black text-amber-200" style={an('fxFadeUp', 0.35, 2.6)}>
                    奪取面前 <span className="font-mono text-amber-300">({fx.stolen.value})</span> {fx.stolen.title}
                  </div>
                )}
              </div>
            );
          } else {
            // 通用：出牌者 ➔ 牌 ➔ 目標，再依牌種顯示中間資訊與結果章
            const stampSrc = fx.stampOn === 'src';
            const stampTgt = fx.stampOn === 'tgt';
            let badges = null;
            let stampAt = 1.5;
            if (kind === 'guess') {
              const gs = fx.guesses || [];
              stampAt = 1.0 + gs.length * 0.3 + 0.3;
              badges = gs.map((g, i) => (
                <div key={i} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-amber-500/60 text-amber-200 font-black text-sm" style={an('fxFlip', 0.35, 1.0 + i * 0.3)}>
                  猜 <span className="font-mono text-lg text-amber-300">{g}</span>
                </div>
              ));
            } else if (kind === 'ask') {
              badges = (
                <div className="px-2.5 py-1 rounded-lg bg-slate-800 border border-amber-500/60 text-amber-200 font-black text-sm" style={an('fxFlip', 0.35, 1.0)}>
                  手牌是 <span className="font-mono text-lg text-amber-300">{fx.question}</span> ？
                </div>
              );
              stampAt = 1.6;
            } else if (kind === 'bounty') {
              badges = (
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-center gap-0.5" style={an('fxFlipIn', 0.3, 1.0)}>
                    {fx.revealed ? <FxFace c={fx.revealed} /> : <FxBack />}
                    <span className="text-[9px] font-black text-fuchsia-300">公開手牌</span>
                  </div>
                  <i className="fa-solid fa-arrow-right text-amber-400 text-xs" style={an('fxFadeUp', 0.3, 1.5)}></i>
                  <div className="flex flex-col items-center gap-0.5" style={an('fxFlipIn', 0.3, 1.7)}>
                    <FxBack />
                    <span className="text-[9px] font-black text-amber-200">重抽 1 張</span>
                  </div>
                </div>
              );
            } else if (kind === 'witch') {
              stampAt = 1.2;
            } else if (kind === 'selfout') {
              stampAt = 0.9;
            }
            revealAt = stampAt + 0.7;
            const srcWrap = (
              <div className="relative" style={an('fxInL', 0.4, 0)}>
                <div style={stampSrc && fx.stampText ? an('fxShake', 0.5, stampAt + 0.2) : undefined}><FxChip p={src} /></div>
                {stampSrc && stamp(stampAt)}
              </div>
            );
            body = (
              <div className="flex flex-col items-center">
                <div className="relative flex items-center justify-center gap-2.5">
                  {srcWrap}
                  <div style={an('fxPop', 0.4, 0.15)}><FxFace c={card} cls="w-14 h-[76px]" /></div>
                  {tgt && tgt !== src && (
                    <>
                      <i className="fa-solid fa-arrow-right text-amber-400 text-sm" style={an('fxFadeUp', 0.3, 0.5)}></i>
                      <div className="relative" style={an('fxInR', 0.4, 0.6)}>
                        <div style={stampTgt && fx.stampText && fx.tone === 'out' ? an('fxShake', 0.5, stampAt + 0.2) : undefined}>
                          <FxChip p={tgt} glow={kind === 'witch' ? 'ring-4 ring-emerald-400/70' : ''} />
                        </div>
                        {stampTgt && stamp(stampAt)}
                      </div>
                    </>
                  )}
                  {tgt && tgt === src && kind !== 'selfout' && (
                    <span className="text-[10px] font-black text-slate-300" style={an('fxFadeUp', 0.3, 0.5)}>對自己</span>
                  )}
                </div>
                {badges && <div className="mt-3 min-h-[40px] flex items-center justify-center gap-2">{badges}</div>}
              </div>
            );
          }

          const reveals = (fx.reveals || []).filter(r => r && r.p);
          const showReveals = reveals.length > 0 && kind !== 'compare' && !(kind === 'bounty' && fx.revealed);
          // 非全屏動畫：點擊區向下延伸覆蓋 D 區（手牌），方便大拇指點「繼續」；動畫本體仍偏上對齊 C 區
          const fxEl = full ? (
            <div
              className={`${replay ? 'fx-hold' : ''} fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm pointer-events-auto flex justify-center items-center ${canDismiss || replay ? 'cursor-pointer' : ''}`}
              style={replay ? undefined : (fx.sticky ? { animation: 'fxIn .25s linear both' } : { animation: `fxIn .25s linear both, fxOut .3s linear ${Math.max(0, fx.duration + (fx.hold !== undefined ? fx.hold : fxHold(fx)) - 300) / 1000}s forwards` })}
              onClick={handleClick}
            >
              <div ref={bodyRef} className="contents">{body}</div>
              {showReveals && (
                <div className="absolute inset-x-0 bottom-7 z-40 flex flex-wrap items-end justify-center gap-x-2.5 gap-y-1 px-2 pointer-events-none" style={an('fxPop', 0.4, revealAt)}>
                  {reveals.map(r => (
                    <div key={r.p.id} className="flex items-center gap-1.5 rounded-lg border border-fuchsia-500/50 bg-slate-950/85 px-1.5 py-1">
                      <span className="text-[9px] font-black leading-tight text-fuchsia-300 whitespace-nowrap">{r.p.name}<br />公開手牌</span>
                      {r.cards && r.cards.length ? r.cards.map((c, ci) => <FxFace key={ci} c={c} cls="w-11 h-[58px]" />) : <span className="text-[9px] text-slate-400">無</span>}
                    </div>
                  ))}
                </div>
              )}
              {replay && <span className="absolute top-4 left-2 z-50 text-[9px] font-black text-amber-300 bg-slate-900/80 border border-amber-500/40 rounded-full px-2 py-0.5 pointer-events-none">回放</span>}
              {!isNone && (replay
                ? <span className="absolute bottom-6 right-4 text-[10px] z-50 text-slate-500 pointer-events-none">點一下離開</span>
                : (
                    <span className="absolute bottom-8 inset-x-0 z-50 text-center pointer-events-none" style={{ animation: `fxIn .3s linear ${fx.duration / 1000}s both` }}>
                      <span className="animate-pulse inline-block text-[10px] font-black text-amber-300 bg-slate-950/80 border border-amber-500/50 rounded-full px-2.5 py-0.5">👆 點一下繼續</span>
                    </span>
                  ))}
            </div>
          ) : isNone ? (
            <div className={`${replay ? 'fx-hold' : ''} absolute inset-x-0 top-6 bottom-0 z-30 rounded-lg flex justify-center items-end pb-3 pointer-events-none`}
              style={replay ? undefined : { animation: `fxIn .25s linear both, fxOut .3s linear ${Math.max(0, fx.duration + (fx.hold !== undefined ? fx.hold : fxHold(fx)) - 300) / 1000}s forwards` }}
            >
              <div ref={bodyRef} className="contents">{body}</div>
            </div>
          ) : (
            <div
              className={`${replay ? 'fx-hold' : ''} fixed inset-x-0 top-[18%] bottom-0 z-[60] flex flex-col pointer-events-auto cursor-pointer max-w-[480px] mx-auto`}
              style={replay ? undefined : (fx.sticky ? { animation: 'fxIn .25s linear both' } : { animation: `fxIn .25s linear both, fxOut .3s linear ${Math.max(0, fx.duration + (fx.hold !== undefined ? fx.hold : fxHold(fx)) - 300) / 1000}s forwards` })}
              onClick={handleClick}
            >
              {/* 上半：C 區動畫本體（半透明遮罩） */}
              <div className="relative flex-1 min-h-0 flex items-center justify-center bg-slate-950/45 rounded-t-lg">
                <div ref={bodyRef} className="contents">{body}</div>
                {showReveals && (
                  <div className="absolute inset-x-0 bottom-7 z-40 flex flex-wrap items-end justify-center gap-x-2.5 gap-y-1 px-2 pointer-events-none" style={an('fxPop', 0.4, revealAt)}>
                    {reveals.map(r => (
                      <div key={r.p.id} className="flex items-center gap-1.5 rounded-lg border border-fuchsia-500/50 bg-slate-950/85 px-1.5 py-1">
                        <span className="text-[9px] font-black leading-tight text-fuchsia-300 whitespace-nowrap">{r.p.name}<br />公開手牌</span>
                        {r.cards && r.cards.length ? r.cards.map((c, ci) => <FxFace key={ci} c={c} cls="w-11 h-[58px]" />) : <span className="text-[9px] text-slate-400">無</span>}
                      </div>
                    ))}
                  </div>
                )}
                {replay && <span className="absolute top-1 left-2 z-50 text-[9px] font-black text-amber-300 bg-slate-900/80 border border-amber-500/40 rounded-full px-2 py-0.5 pointer-events-none">回放</span>}
                <span className="absolute bottom-1 right-2 z-50 text-[8px] text-slate-500 pointer-events-none" style={{ animation: `fxOut .2s linear ${fx.duration / 1000}s forwards` }}>點一下略過</span>
              </div>
              {/* 下半：延伸至 D 區的可點擊帶（不擋閱讀，僅接收點擊） */}
              <div className="h-[30%] min-h-[120px] w-full bg-slate-950/25 flex items-start justify-center pt-2">
                <span className="pointer-events-none" style={{ animation: `fxIn .3s linear ${fx.duration / 1000}s both` }}>
                  <span className="animate-pulse inline-block text-[10px] font-black text-amber-300 bg-slate-950/80 border border-amber-500/50 rounded-full px-2.5 py-0.5">👆 點一下繼續</span>
                </span>
              </div>
            </div>
          );
          const contextualFx = <window.LocalPlayerContext.Provider value={localPlayerId}>{fxEl}</window.LocalPlayerContext.Provider>;
          // 全屏與一般動畫皆 portal 到 body，點擊區才能蓋到 D 區手牌
          return createPortal(contextualFx, document.body);
        }
        // ==== FX END ====
;Object.assign(window, { playedCardsOf, FX_KIND, FX_DURATION, PASSIVE_WHY, fxHold, FX_SHOW_NONE, FX_TOTAL, FX_TOTAL_BY, FX_STAMP_TEXT, FX_STAMP_CLS, deriveFx, buildScoreFx, Avatar, FxChip, FxBack, FxMine, FxFace, FxFaceMini, FxStamp, FxOverlay });

export {
  playedCardsOf, FX_KIND, FX_DURATION, PASSIVE_WHY, fxHold, FX_SHOW_NONE,
  FX_TOTAL, FX_TOTAL_BY, FX_STAMP_TEXT, FX_STAMP_CLS, deriveFx, buildScoreFx,
  Avatar, FxChip, FxBack, FxMine, FxFace, FxFaceMini, FxStamp, FxOverlay,
};
console.log('[cards] Vite module loaded', typeof playedCardsOf, typeof deriveFx, typeof FxOverlay);
