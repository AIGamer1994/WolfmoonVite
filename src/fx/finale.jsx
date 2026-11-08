import React from 'react';
import { Avatar } from '../components/Avatar.jsx';
import { FxChip } from './FxChip.jsx';
import '../styles/finale.css';

function FinaleFx({ fx, src, card, localPlayerId = 0, an }) {
  const { kind } = fx;
  let body = null;
  if (kind === 'moon' || kind === 'wolfbite') {
    // 月亮升起：第 1 張彎月、第 2 張半月、第 3 張全月（天空一開始是黑的，月亮升起後才轉紅，狼月降臨）
    // wolfbite：第 3 張月亮之後，有人用拿一還一／守夜人把狼人留在手上 ➔ 直接是紅月，接著只播「咬向鏡頭」
    const bite = kind === 'wolfbite';
    const ph = fx.phase || 1;
    const red = ph >= 3;
    const held = red && fx.wolf === 'held';
    const tRed = bite ? 0 : 2.3;      // 月亮與天空轉紅的開始時間
    const tGlow = bite ? 0.1 : 2.6;   // 紅光脈動
    const tB = bite ? 1.3 : 3.7;      // 黑幕蓋上、咬鏡頭演出開始
    const mnames = ['孤狼月亮', '嘯狼月亮', '狼人月亮'];
    const moonSvg = (isRed, gid) => (
      <svg width="150" height="150" viewBox="0 0 100 100" style={{ filter: isRed ? 'drop-shadow(0 0 18px rgba(248,113,113,.9))' : 'drop-shadow(0 0 14px rgba(253,230,138,.7))' }}>
        <defs>
          <radialGradient id={`fxMnG${gid}`} cx="40%" cy="35%">
            <stop offset="0" stopColor={isRed ? '#fee2e2' : '#fffbeb'} />
            <stop offset="1" stopColor={isRed ? '#f87171' : '#fcd34d'} />
          </radialGradient>
          <mask id={`fxMnMask${gid}`}><rect width="100" height="100" fill="white" /><circle cx="68" cy="42" r="38" fill="black" /></mask>
        </defs>
        {ph === 1 && <circle cx="50" cy="50" r="42" fill={`url(#fxMnG${gid})`} mask={`url(#fxMnMask${gid})`} />}
        {ph === 2 && (<>
          <circle cx="50" cy="50" r="42" fill="#fde68a" opacity=".12" />
          <path d="M50 8 A42 42 0 0 0 50 92 Z" fill={`url(#fxMnG${gid})`} />
        </>)}
        {ph >= 3 && (<>
          <circle cx="50" cy="50" r="42" fill={`url(#fxMnG${gid})`} />
          <circle cx="38" cy="38" r="7" fill={isRed ? '#7f1d1d' : '#92400e'} opacity=".14" />
          <circle cx="62" cy="58" r="9" fill={isRed ? '#7f1d1d' : '#92400e'} opacity=".12" />
          <circle cx="44" cy="66" r="5" fill={isRed ? '#7f1d1d' : '#92400e'} opacity=".12" />
        </>)}
      </svg>
    );
    const teeth = [[3, 12, 14], [17, 16, 34], [33, 13, 16], [47, 14, 18], [61, 13, 16], [77, 16, 34], [91, 12, 14]];
    const jawSvg = (flip) => (
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full h-full" style={{ transform: flip ? 'scaleY(-1)' : undefined }}>
        <rect x="0" y="0" width="100" height="24" fill="#3b0a0a" />
        <rect x="0" y="0" width="100" height="9" fill="#1c0505" />
        <rect x="0" y="16" width="100" height="8" fill="#7f1d1d" />
        {teeth.map(([x, w, h], i) => <polygon key={i} points={`${x},24 ${x + w},24 ${x + w / 2},${24 + h}`} fill="#f5f5f4" stroke="#a8a29e" strokeWidth=".4" />)}
      </svg>
    );
    const wp = fx.wolfWinner, tp = fx.traitorWinner;
    body = (<>
      <div className="relative w-full h-full overflow-hidden" style={{ background: red ? 'linear-gradient(#000,#04050b 70%,#0a0b14)' : 'linear-gradient(#050816,#12183a 70%,#1e2350)' }}>
        {[[12, 10], [30, 28], [55, 8], [78, 22], [90, 12], [18, 48], [85, 50], [45, 36], [68, 40]].map(([x, y], i) => (
          <span key={i} className="absolute w-[2px] h-[2px] rounded-full bg-white" style={{ left: `${x}%`, top: `${y}%`, ...an('fxFadeUp', 0.6, 0.2 + i * 0.15) }}></span>
        ))}
        {red && <div className="absolute inset-0" style={{ background: 'linear-gradient(#1a0508,#4a0d14 70%,#2a0a0e)', animation: `fxIn ${bite ? 0.3 : 1.2}s ease ${tRed}s both` }}></div>}
        {red && <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 55%, rgba(239,68,68,.35), transparent 65%)', animation: `fxIn ${bite ? 0.3 : 0.8}s ease ${tGlow}s both, fxRedPulse 1.2s ease-in-out ${tGlow + 0.8}s infinite alternate` }}></div>}
        <div className="absolute left-1/2 -ml-[75px] bottom-[26%]" style={bite ? an('fxIn', 0.3, 0) : an('fxMoonRise', 2.2, 0.2, 'cubic-bezier(.2,.8,.3,1)')}>
          <div className="relative w-[150px] h-[150px]">
            {moonSvg(false, 'a')}
            {red && <div className="absolute inset-0" style={{ animation: `fxIn ${bite ? 0.3 : 0.9}s ease ${tRed}s both` }}>{moonSvg(true, 'b')}</div>}
          </div>
        </div>
        <svg className="absolute bottom-0 left-0 w-full h-[24%]" viewBox="0 0 270 84" preserveAspectRatio="none">
          <path d="M0 40 Q40 14 80 36 T150 30 T220 38 T270 24 L270 84 L0 84 Z" fill="#05060f" />
          <path d="M0 62 Q60 44 120 58 T270 52 L270 84 L0 84 Z" fill="#02030a" />
        </svg>
        <div className="absolute top-[9%] inset-x-0 text-center" style={an('fxFadeUp', 0.5, 0.1)}>
          <div className="text-xs text-slate-300 font-bold mb-1">{src ? src.name : ''} {bite ? '手握【狼人】' : '翻開了'}</div>
          <div className={`text-xl font-black tracking-widest ${red ? 'text-rose-300' : 'text-amber-200'}`}>{mnames[ph - 1] || card.title}</div>
        </div>
        <div className="absolute bottom-14 inset-x-0 flex flex-col items-center gap-1" style={an('fxPop', 0.4, bite ? 0.4 : (red ? 3.0 : 1.4))}>
          <div className="flex gap-1.5">{[1, 2, 3].map(i => <i key={i} className={`fa-solid fa-moon text-sm ${i <= ph ? (red ? 'text-rose-300' : 'text-amber-300') : 'text-slate-600'}`}></i>)}</div>
          <div className={`text-[10px] font-black ${red ? 'text-rose-200' : 'text-slate-200'}`}>月亮 {ph}/3{red ? (fx.wolf === 'held' ? '・狼月降臨' : (fx.wolf === 'out' ? '・狼人已被淘汰，無人掌控狼月' : '・無人手握狼人')) : ''}</div>
        </div>
      </div>
      {held && (
        <div className="absolute inset-0 z-40 overflow-hidden bg-slate-950/75 pointer-events-none" style={{ animation: `fxIn .5s linear ${tB}s both` }}>
          <div className="absolute inset-0" style={{ animation: `fxShake .45s linear ${tB + 1.5}s both` }}>
            {/* 一口咬向鏡頭 */}
            <div className="absolute inset-0" style={{ animation: `fxOut .5s linear ${tB + 2.0}s forwards` }}>
              <div className="absolute inset-x-0 top-0 h-[58%]" style={{ animation: `fxJawOpenT .5s ease-out ${tB + 0.8}s both, fxJawSlamT .16s cubic-bezier(.6,0,1,.6) ${tB + 1.35}s forwards` }}>{jawSvg(false)}</div>
              <div className="absolute inset-x-0 bottom-0 h-[58%]" style={{ animation: `fxJawOpenB .5s ease-out ${tB + 0.8}s both, fxJawSlamB .16s cubic-bezier(.6,0,1,.6) ${tB + 1.35}s forwards` }}>{jawSvg(true)}</div>
            </div>
            <div className="absolute inset-0 bg-white" style={{ animation: `fxFlashW .2s ease-out ${tB + 1.5}s both` }}></div>
            <div className="absolute inset-0 bg-red-700" style={{ animation: `fxFlood .9s ease-out ${tB + 1.5}s both` }}></div>
          </div>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(127,29,29,.55), #000 75%)', animation: `fxIn .6s ease ${tB + 2.1}s both` }}></div>
          {/* 結尾：標出獲勝者 */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={an('fxPop', 0.5, tB + 1.8)}>
            <div className="text-lg font-black tracking-[0.3em] text-rose-300" style={{ textShadow: '0 0 14px rgba(239,68,68,.9)' }}>狼月降臨</div>
            {wp && <FxChip p={wp} size="w-14 h-14 text-2xl" glow="ring-4 ring-rose-500/80" />}
            <div className="text-sm font-black text-rose-200">🐺 {wp ? wp.name : '狼人'} 獲勝</div>
            {tp && <div className="text-[11px] font-black text-fuchsia-300">叛徒【{tp.name}】共同獲勝</div>}
          </div>
        </div>
      )}
    </>);
  } else if (kind === 'vampire') {
    // 吸血鬼降臨：黃月＋黑色城堡剪影 ➔ 蝙蝠群飛散 ➔ 血潮淹沒 ➔ 頭像兩旁展翅、標題與獲勝者
    const vp = src;
    const hi = fx.highCards || [];
    const batPath = 'M0 -2 C-5 -10 -18 -11 -28 -3 C-21 -3 -17 1 -14 8 C-10 3 -5 3 0 9 C5 3 10 3 14 8 C17 1 21 -3 28 -3 C18 -11 5 -10 0 -2 Z';
    const bats = [
      [-135, -40, 1.2, 1.2, 2.2], [120, -65, 1.0, 1.25, 2.15], [-105, 30, .9, 1.35, 2.3], [135, 15, 1.3, 1.4, 2.1],
      [-45, -120, .9, 1.45, 2.25], [55, -105, 1.1, 1.5, 2.1], [-150, 80, .8, 1.55, 2.3], [150, 65, .85, 1.6, 2.2],
      [-15, -80, 1.5, 1.65, 2.0], [20, 85, .7, 1.7, 2.2], [-85, -85, .9, 1.75, 2.1], [100, -20, 1.0, 1.8, 2.15],
    ];
    const wingPath = 'M110 50 C90 16 50 5 4 18 C24 22 34 32 38 44 C28 42 18 44 10 52 C26 54 36 62 40 74 C34 74 26 78 20 86 C38 86 54 88 70 98 C82 80 96 66 110 60 Z';
    const wingStyle = (origin) => ({ width: 80, height: 72, flex: 'none', fill: '#0b0204', stroke: '#ef4444', strokeWidth: 1.6, filter: 'drop-shadow(0 0 8px rgba(239,68,68,.75))', transformOrigin: origin, animation: 'vpWing .8s cubic-bezier(.2,.9,.3,1.15) 4.4s both' });
    body = (
      <div className="relative w-full h-full overflow-hidden" style={{ background: 'linear-gradient(#070b22 0%,#141235 50%,#3a2a52 100%)' }}>
        <div className="absolute" style={{ left: '50%', top: 100, width: 112, height: 112, marginLeft: -56, borderRadius: '50%', background: 'radial-gradient(circle at 38% 34%,#fffbeb 0%,#fde68a 40%,#fbbf24 78%,#d97706 100%)', boxShadow: '0 0 40px 10px rgba(251,191,36,.55), 0 0 100px 30px rgba(251,191,36,.25)', animation: 'vpMoonRise 1.6s cubic-bezier(.2,.8,.3,1) .1s both' }}></div>
        <svg className="absolute bottom-0 left-0 w-full" style={{ height: '26%' }} viewBox="0 0 360 210" preserveAspectRatio="none">
          <path fill="#000" d="M0 210 V120 L22 120 L22 96 L30 80 L38 96 L38 124 L62 124 L62 104 L82 104 L82 70 L88 52 L94 70 L94 104 L118 104 L118 130 L150 130 L150 90 L160 56 L168 30 L176 56 L186 90 L186 126 L214 126 L214 98 L236 98 L236 66 L244 46 L252 66 L252 98 L276 98 L276 122 L304 122 L304 100 L322 84 L340 100 L340 124 L360 124 V210 Z" />
        </svg>
        <div className="absolute inset-0 pointer-events-none" style={{ animation: 'fxOut .5s linear 3.0s both' }}>
          {bats.map(([x, y, sc, t, d], i) => (
            <div key={i} className="absolute" style={{ left: '50%', top: 170, width: 62, height: 25, margin: '-12px 0 0 -31px', '--ex': `${x}px`, '--ey': `${y}px`, '--s': sc, animation: `vpBatFly ${d}s cubic-bezier(.3,.1,.5,1) ${t}s both` }}>
              <svg className="vp-bat-svg" viewBox="-30 -12 60 24"><path d={batPath} /></svg>
            </div>
          ))}
        </div>
        <div className="absolute left-0 right-0 top-0" style={{ height: '112%', transform: 'translateY(-100%)', background: 'linear-gradient(#7f1d1d 0%,#991b1b 35%,#450a0a 100%)', animation: 'vpFlood 1.05s cubic-bezier(.5,.1,.3,1) 3.1s both' }}>
          <svg className="absolute left-0 w-full" style={{ bottom: -1, height: 44, transform: 'translateY(42px)' }} viewBox="0 0 360 60" preserveAspectRatio="none">
            <path fill="#450a0a" d="M0 0 H360 V20 Q340 54 320 22 Q300 8 280 34 Q262 60 244 26 Q226 6 206 30 Q188 56 168 24 Q150 4 130 32 Q112 58 92 24 Q74 6 54 30 Q34 52 18 24 Q8 12 0 22 Z" />
          </svg>
        </div>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 46%, transparent 30%, rgba(0,0,0,.6) 100%)' }}></div>
        {[[12, 4.2, 3.0], [30, 4.9, 2.6], [50, 4.4, 3.3], [68, 5.3, 2.8], [86, 4.6, 3.1]].map(([x, t, d], i) => (
          <span key={i} className="absolute" style={{ left: `${x}%`, top: -10, width: 6, height: 10, borderRadius: '50%/65% 65% 35% 35%', background: 'linear-gradient(#ef4444,#7f1d1d)', opacity: 0, animation: `vpDrop ${d}s ease-in ${t}s infinite` }}></span>
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
          <div style={{ fontFamily: '"Noto Serif TC","Songti TC","PMingLiU",serif', fontWeight: 900, fontSize: 31, letterSpacing: '.18em', paddingLeft: '.18em', lineHeight: 1.1, background: 'linear-gradient(#fff1f2 0%,#fb7185 45%,#b91c1c 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', textShadow: 'none', filter: 'drop-shadow(0 0 10px rgba(239,68,68,.9)) drop-shadow(0 2px 0 #450a0a)', animation: 'vpTitle .9s cubic-bezier(.2,.9,.3,1) 3.7s both' }}>吸血鬼降臨</div>
          <div className="flex items-center justify-center" style={{ height: 76 }}>
            <svg style={{ ...wingStyle('100% 50%'), marginRight: -4 }} viewBox="0 0 112 100"><path d={wingPath} /></svg>
            <div style={an('fxPop', 0.5, 4.2)}>
              <div className="rounded-full" style={{ animation: 'vpAvaGlow 1.2s ease-in-out 4.8s infinite alternate' }}>
                <Avatar p={vp} size="w-16 h-16" />
              </div>
            </div>
            <svg style={{ ...wingStyle('0% 50%'), marginLeft: -4 }} viewBox="0 0 112 100"><g transform="matrix(-1 0 0 1 112 0)"><path d={wingPath} /></g></svg>
          </div>
          <div className="text-[9px] font-bold text-rose-300" style={{ letterSpacing: '.5em', paddingLeft: '.5em', ...an('fxFadeUp', 0.6, 4.7) }}>VAMPIRE ASCENDANT</div>
          <div className="text-sm font-black text-rose-100" style={an('fxFadeUp', 0.6, 5.0)}>🩸 <b className={vp && vp.id === localPlayerId ? 'text-sky-300' : 'text-amber-200'}>{vp ? vp.name : ''}</b> 獲勝</div>
          <div className="flex flex-wrap items-center justify-center gap-1 text-[10px] text-rose-300 px-3" style={an('fxFadeUp', 0.6, 5.3)}>
            <span>面前集滿</span>
            {hi.map((c, ci) => (
              <span key={ci} className="inline-flex items-center gap-0.5 rounded border border-rose-500 bg-black/45 px-1 py-px font-black text-rose-100"><span className="font-mono text-amber-200">{c.value}</span>{c.title}</span>
            ))}
            <span>7 以上 ×{hi.length}</span>
          </div>
        </div>
      </div>
    );
  }
  return body;
}

export { FinaleFx };
