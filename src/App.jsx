import React from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { GameBoard } from './components/GameBoard.jsx';
import { InteractionDialog } from './components/InteractionDialog.jsx';
import { RichLog } from './components/RichLog.jsx';
import { FIREBASE_CONFIG, isFirebaseConfigured, setFirebaseAnalytics, trackAnalyticsEvent } from './config/firebase.js';
import { BASE_CARDS_DEF, MOON_CARDS, WEREWOLF_CARD } from './data/cards.js';
import { INITIAL_PLAYERS } from './data/players.js';
import { RULES_CARDS, RULES_SECTIONS } from './data/rules.js';
import { FxBack, buildScoreFx, deriveFx, playedCardsOf } from './fx/cards.jsx';
import { FX_DURATION, FX_TOTAL_BY, PASSIVE_WHY, fxHold } from './fx/fxConfig.js';
import { canSteal, numEmoji } from './utils/cards.js';
import { centerKnowledge, makeCenterMeta } from './utils/centerMeta.js';
import { safeStorageGet, safeStorageSet } from './utils/storage.js';

const { useState, useEffect, useMemo, useRef } = React;

function App() {
  const [version] = useState('v0.0.21');
  // 牌桌設計尺寸（約 9:16）；矮／窄視窗用 transform 整桌等比縮放，卡牌一併縮小
  const GAME_DESIGN_W = 390;
  const GAME_DESIGN_H = 693;
  const [gameScale, setGameScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const s = Math.min(
        window.innerWidth / GAME_DESIGN_W,
        window.innerHeight / GAME_DESIGN_H,
        480 / GAME_DESIGN_W,
      );
      setGameScale(Number.isFinite(s) && s > 0 ? s : 1);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const [screen, setScreen] = useState('home');
  const [displayName, setDisplayName] = useState(() => safeStorageGet('wolfmoon.displayName') || '');
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [firebaseStatus, setFirebaseStatus] = useState(isFirebaseConfigured() ? 'connecting' : 'setup');
  const [roomCode, setRoomCode] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [lobbyError, setLobbyError] = useState('');
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [nextGameBusy, setNextGameBusy] = useState(false);
  const [onlineSession, setOnlineSession] = useState(false);
  const roomRef = useRef(null);
  const gameRevisionRef = useRef(0);
  const turnSeqRef = useRef(0); // 單調遞增的換人序號（取代以 currentTurnIndex 大小判斷新舊，避免繞圈時誤判）
  const lastActorUidRef = useRef(null);
  const applyingRemoteGameRef = useRef(false);
  const gameSyncTimerRef = useRef(null);
  const publishInFlightRef = useRef(false); // 同一時間只允許一個 RTDB transaction 在飛，避免用舊 revision 互相打架
  const publishStartRef = useRef(0);
  const publishDirtyRef = useRef(false);    // 在飛期間又有新狀態 ➔ 完成後必須再發一次
  const publishRetryRef = useRef(0);        // transaction 被中止後的連續重試次數
  const publishGenRef = useRef(0);          // 每局遞增；舊局在飛的 transaction 不可寫入／更新 revision
  const fxEventKeyRef = useRef(null);
  const fxTimerRef = useRef(null);
  const fxQueueRef = useRef([]);
  const fxCurRef = useRef(null);
  const fxShownRef = useRef(false);
  const scoreDoneKeysRef = useRef(new Set()); // 本機已點擊關閉的終局／結算動畫 key（只屬於本機，不同步）
  const presentLocalFxRef = useRef(null);
  const fastRef = useRef(false);
  const humanIdRef = useRef(0);
  const [gameReady, setGameReady] = useState(false);
  const [forceApplyTick, setForceApplyTick] = useState(0); // Guest 救援：強制重跑套用遠端

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setFirebaseStatus('setup');
      return;
    }
    if (!window.firebase) {
      setFirebaseStatus('error');
      setLobbyError('Firebase SDK 載入失敗，請檢查網路連線後重新整理。');
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      if (firebase.analytics && firebase.analytics.isSupported) {
        firebase.analytics.isSupported().then(supported => {
          if (supported) setFirebaseAnalytics(firebase.analytics());
        }).catch(error => console.warn('Firebase Analytics is unavailable:', error));
      }
      const unsubscribe = firebase.auth().onAuthStateChanged(user => {
        if (user) {
          setFirebaseUser(user);
          setFirebaseStatus('ready');
          setLobbyError('');
        } else {
          firebase.auth().signInAnonymously().catch(error => {
            setFirebaseStatus('error');
            setLobbyError(`Firebase 匿名登入失敗：${error.message}`);
          });
        }
      }, error => {
        setFirebaseStatus('error');
        setLobbyError(`Firebase 登入狀態讀取失敗：${error.message}`);
      });
      return unsubscribe;
    } catch (error) {
      setFirebaseStatus('error');
      setLobbyError(`Firebase 初始化失敗：${error.message}`);
    }
  }, []);

  useEffect(() => {
    if (!roomCode || !firebaseUser || !isFirebaseConfigured()) return;
    const ref = firebase.database().ref(`rooms/${roomCode}`);
    roomRef.current = ref;
    const onValue = snapshot => {
      const nextRoom = snapshot.val();
      if (!nextRoom) {
        setRoomData(null);
        setRoomCode('');
        setScreen('home');
        setLobbyError('房間已關閉或不存在。');
        return;
      }
      setRoomData(nextRoom);
      if (nextRoom.status === 'playing') {
        setOnlineSession(true);
        // 對局中／局末準備下一局皆留在牌桌，避免非房主被踢回大廳只看到「等待房主」
        setScreen('game');
      } else if (nextRoom.status === 'lobby') {
        setScreen('lobby');
      }
    };
    const onError = error => setLobbyError(`房間同步失敗：${error.message}`);
    ref.on('value', onValue, onError);
    return () => {
      ref.off('value', onValue);
      if (roomRef.current === ref) roomRef.current = null;
    };
  }, [roomCode, firebaseUser]);

  useEffect(() => {
    if (!onlineSession || screen !== 'game' || !firebaseUser || !roomCode || !window.firebase) return;
    const ref = firebase.database().ref(`rooms/${roomCode}/gameState/fxEvent`);
    let isInitialValue = true;
    const onValue = snapshot => {
      const event = snapshot.val();
      const initialSnapshot = isInitialValue;
      if (isInitialValue) {
        isInitialValue = false;
        fxEventKeyRef.current = event && event.key || null;
      }
      if (!event) {
        fxEventKeyRef.current = null;
        return;
      }
      if (!event.key) return;
      const isNewEvent = event.key !== fxEventKeyRef.current;
      const shouldShowEvent = isNewEvent || initialSnapshot;
      if (shouldShowEvent) {
        fxEventKeyRef.current = event.key;
        const viewerId = humanIdRef.current;
        if (event.sourceUid !== firebaseUser.uid) {
          // 若有私密動畫且自己在 privateTo 內 → 用私密版；否則用公開版
          const priv = event.privateFx && event.privateFx.kind && Array.isArray(event.privateFx.privateTo) && event.privateFx.privateTo.includes(viewerId)
            ? event.privateFx
            : null;
          const pub = event.fx && event.fx.kind && (!event.fx.privateTo?.length || event.fx.privateTo.includes(viewerId))
            ? event.fx
            : null;
          const chosen = priv || pub;
          if (chosen) {
            const receivedFx = { ...chosen, sticky: chosen.sticky !== false && chosen.kind !== 'none' };
            if (fxCurRef.current || fxShownRef.current) {
              fxQueueRef.current.push(receivedFx);
            } else if (presentLocalFxRef.current) {
              presentLocalFxRef.current(receivedFx);
            } else {
              fxCurRef.current = receivedFx;
              fxShownRef.current = !!receivedFx.sticky;
              setFx(receivedFx);
            }
          }
        }
      }
    };
    const onError = error => {
      console.error('動畫同步失敗：', error);
      setLobbyError(`動畫同步失敗：${error.message}`);
    };
    ref.on('value', onValue, onError);
    return () => {
      ref.off('value', onValue);
      clearTimeout(fxTimerRef.current);
    };
  }, [onlineSession, screen, firebaseUser, roomCode]);

  const saveDisplayName = () => {
    const name = displayName.trim().slice(0, 16);
    if (!name) {
      setLobbyError('請先輸入玩家名稱。');
      return false;
    }
    setDisplayName(name);
    safeStorageSet('wolfmoon.displayName', name);
    setLobbyError('');
    return name;
  };

  const makeRoomCode = () => {
    // 6 位純數字（100000–999999）
    return String(Math.floor(100000 + Math.random() * 900000));
  };

  const createRoom = async () => {
    const name = saveDisplayName();
    if (!name) return;
    if (!firebaseUser || firebaseStatus !== 'ready') {
      setLobbyError('Firebase 尚未連線，請稍後再試。');
      return;
    }
    setLobbyBusy(true);
    try {
      const code = makeRoomCode();
      const initialRoom = {
        hostUid: firebaseUser.uid,
        status: 'lobby',
        aiCount: 0,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        players: { [firebaseUser.uid]: { uid: firebaseUser.uid, name, joinedAt: Date.now() } },
      };
      const result = await firebase.database().ref(`rooms/${code}`).transaction(current => current === null ? initialRoom : undefined);
      if (!result.committed) throw new Error('房間號碼重複，請再試一次。');
      setRoomCode(code);
      setRoomData(result.snapshot.val());
      setOnlineSession(true);
      setScreen('lobby');
      trackAnalyticsEvent('create_room');
    } catch (error) {
      setLobbyError(`建立房間失敗：${error.message}`);
    } finally {
      setLobbyBusy(false);
    }
  };

  const joinRoom = async () => {
    const name = saveDisplayName();
    if (!name) return;
    if (!firebaseUser || firebaseStatus !== 'ready') {
      setLobbyError('Firebase 尚未連線，請稍後再試。');
      return;
    }
    const code = roomInput.trim().replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) {
      setLobbyError('房間號碼需為 6 位數字。');
      return;
    }
    setLobbyBusy(true);
    try {
      const ref = firebase.database().ref(`rooms/${code}`);
      const roomSnapshot = await ref.once('value');
      const currentRoom = roomSnapshot.val();
      if (!currentRoom || currentRoom.status !== 'lobby') throw new Error('房間不存在或已開始。');
      const currentPlayers = currentRoom.players || {};
      if (!currentPlayers[firebaseUser.uid] && Object.keys(currentPlayers).length + (currentRoom.aiCount || 0) >= 6) {
        throw new Error('房間人數已滿。');
      }
      const result = await ref.child(`players/${firebaseUser.uid}`).transaction(current => ({
        uid: firebaseUser.uid,
        name,
        joinedAt: current && current.joinedAt ? current.joinedAt : Date.now(),
      }));
      if (!result.committed) throw new Error('加入房間失敗，請再試一次。');
      const updatedRoom = await ref.once('value');
      if (!updatedRoom.exists()) throw new Error('房間已關閉。');
      setRoomCode(code);
      setRoomData(updatedRoom.val());
      setOnlineSession(true);
      setScreen('lobby');
      setRoomInput('');
      trackAnalyticsEvent('join_room');
    } catch (error) {
      setLobbyError(`加入房間失敗：${error.message}`);
    } finally {
      setLobbyBusy(false);
    }
  };

  const updateAiCount = async delta => {
    if (!roomData || roomData.hostUid !== (firebaseUser && firebaseUser.uid)) return;
    const humans = Object.keys(roomData.players || {}).length;
    const next = Math.max(0, Math.min(6 - humans, (roomData.aiCount || 0) + delta));
    if (next === (roomData.aiCount || 0)) return;
    try {
      await roomRef.current.child('aiCount').set(next);
      trackAnalyticsEvent(delta > 0 ? 'add_ai' : 'remove_ai');
      setLobbyError('');
    } catch (error) {
      setLobbyError(`更新 AI 人數失敗：${error.message}`);
    }
  };

  const startOnlineGame = async () => {
    if (!roomData || roomData.hostUid !== (firebaseUser && firebaseUser.uid)) return;
    const humans = Object.values(roomData.players || {}).sort((a, b) => a.joinedAt - b.joinedAt);
    const aiCount = roomData.aiCount || 0;
    if (humans.length + aiCount < 3 || humans.length + aiCount > 6) {
      setLobbyError('總玩家數（真人＋AI）需為 3–6 人才能開始。');
      return;
    }
    const roster = [
      ...humans.map(p => ({ uid: p.uid, name: p.name, isAI: false })),
      ...Array.from({ length: aiCount }, (_, i) => ({ name: `AI ${i + 1}`, isAI: true })),
    ].map((p, id) => {
      const template = INITIAL_PLAYERS[(id + 1) % INITIAL_PLAYERS.length];
      return { ...template, ...p, id, seed: p.uid || `AI-${id}`, status: '存活', protected: false, playedCards: [], witchRevived: false, handTaken: false };
    });
    try {
      await roomRef.current.update({ status: 'playing', gamePlayers: roster, gameState: null, nextReady: null });
      setOnlineSession(true);
      trackAnalyticsEvent('start_game');
    } catch (error) {
      setLobbyError(`開始遊戲失敗：${error.message}`);
    }
  };

  const leaveRoom = async () => {
    if (roomRef.current && firebaseUser && roomData) {
      try {
        const players = { ...(roomData.players || {}) };
        delete players[firebaseUser.uid];
        if (Object.keys(players).length === 0) {
          await roomRef.current.remove();
        } else {
          const updates = { [`players/${firebaseUser.uid}`]: null };
          if (roomData.hostUid === firebaseUser.uid) {
            const nextHost = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt)[0];
            updates.hostUid = nextHost.uid;
          }
          await roomRef.current.update(updates);
        }
      } catch (error) {
        setLobbyError(`離開房間失敗：${error.message}`);
      }
    }
    setRoomCode('');
    setRoomData(null);
    setOnlineSession(false);
    setScreen('home');
  };

  // 全局遊戲狀態
  const [players, setPlayers] = useState(INITIAL_PLAYERS);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);

  // 雙行動態廣播狀態 (Line 1: 動作簡報, Line 2: 最終結果)
  const [broadcastAction, setBroadcastActionRaw] = useState('狼月降臨！準備開啟遊戲');
  const [broadcastReveal, setBroadcastReveal] = useState('');   // 第 3 行：公開手牌
  const [broadcastEvent, setBroadcastEvent] = useState(null);   // { type: 'out' | 'revive', key }
  const [broadcastPrivate, setBroadcastPrivate] = useState(null);
  // 任何新的動作廣播都會清掉上一筆的「公開手牌」與亮燈
  const [broadcastResult, setBroadcastResultRaw] = useState('輪到你的回合');

  const [moonPhase, setMoonPhase] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winnerInfo, setWinnerInfo] = useState(null);
  const [wins, setWins] = useState({}); // 勝場月亮標記（跨局累計）
  const [victoryReady, setVictoryReady] = useState(false); // 勝利視窗：等播放時長結束（不等 sticky 點擊）後出現
  const [victoryDismissed, setVictoryDismissed] = useState(false); // 勝利視窗已關閉（返回牌桌查看全部牌）

  // 牌庫、備用牌、手牌、中央牌
  const [deck, setDeck] = useState([]);
  const [reserveCards, setReserveCards] = useState([]);
  const [playerHands, setPlayerHands] = useState({});
  const [centerCards, setCenterCards] = useState([]);
  const [playedCardArena, setPlayedCardArena] = useState(null);
  const [recentArenaCards, setRecentArenaCards] = useState([]);
  const [arenaFanOpen, setArenaFanOpen] = useState(false);
  const [arenaFocus, setArenaFocus] = useState(null);
  const [showBroadcast, setShowBroadcast] = useState(false); // C 區頂部「動態」廣播：預設開啟
  const [fx, setFx] = useState(null);          // C 區效果動畫
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const fxUntilRef = useRef(0);
  const [replay, setReplay] = useState(null); // { fx, n }：點紀錄回放的動畫
  const [historyLogs, setHistoryLogs] = useState([]);
  const [witchTargetOwner, setWitchTargetOwner] = useState(null);

  const [selectedHandCard, setSelectedHandCard] = useState(null);

  // 彈窗與互動介面狀態
  const [isDeckModalOpen, setIsDeckModalOpen] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isCenterCardsModalOpen, setIsCenterCardsModalOpen] = useState(false);
  const [centerMeta, setCenterMeta] = useState(() => [0, 1, 2].map(makeCenterMeta));
  const [centerKnownSet, setCenterKnownSet] = useState(null); // （保留，不再使用）
  const [watchLog, setWatchLog] = useState([]);   // 守夜人使用紀錄（公開：誰看過3張、換過1張）
  const [watchNote, setWatchNote] = useState(null); // 玩家本人用守夜人的私人備註 { text, stale }
  const [centerPickMode, setCenterPickMode] = useState(false);
  const [pickSlot, setPickSlot] = useState(null);

  // 互動能力彈窗
  const [interactionModal, setInteractionModal] = useState(null);
  const [isReturningCenterCard, setIsReturningCenterCard] = useState(false);
  const [extraTurnPlayerId, setExtraTurnPlayerId] = useState(null);
  const [turnTick, setTurnTick] = useState(0);
  const [syncTick, setSyncTick] = useState(0); // 強制重新發布本機狀態
  const [aiKick, setAiKick] = useState(0); // 只在 proceedToNext 遞增：額外回合（同一人再行動）時也能重新驅動 AI
  const [actionLocked, setActionLocked] = useState(false);
  const lockRef = useRef(false);
  const [seerSeen, setSeerSeen] = useState(null); // 先知看過的 { targetId, card }（只有玩家自己看得到）
  const [drunkSeen, setDrunkSeen] = useState(null); // 醉漢檢視過的在場手牌 [{ targetId, card }]（含自己；僅出牌者看得到，洗牌後換過就標舊資訊）
  // 速度：1＝正常，0.5＝放慢（AI 等待、月亮停留、效果動畫都按倍數拉長）；再點一次同一顆回到 1x
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const slow = () => 1 / speedRef.current;
  const changeSpeed = (v) => { const nv = speedRef.current === v ? 1 : v; speedRef.current = nv; setSpeed(nv); };
  // 玩家抽牌小動畫（D 區）：牌背從上方飛入 ➔ 翻面 ➔ 短暫放大 ➔ 歸位成手牌。純視覺，不鎖操作；點手牌或拖曳可立即略過
  const [drawAnim, setDrawAnim] = useState(null);
  const drawAnimTimerRef = useRef(null);
  const clearDrawAnim = () => {
    if (drawAnimTimerRef.current) { clearTimeout(drawAnimTimerRef.current); drawAnimTimerRef.current = null; }
    setDrawAnim(null);
  };
  // from：'deck'＝從牌庫（右上）飛來；'center'＝從中央暗牌飛來。handCount：抽完後的手牌張數（2 張時新牌在右邊）
  const playDrawAnim = (card, from = 'deck', handCount = 2) => {
    if (!card) return;
    if (drawAnimTimerRef.current) clearTimeout(drawAnimTimerRef.current);
    const k = slow();
    setDrawAnim({ key: `${Date.now()}-${Math.random()}`, card, from, toX: handCount >= 2 ? 71 : 0, k });
    drawAnimTimerRef.current = setTimeout(() => { drawAnimTimerRef.current = null; setDrawAnim(null); }, Math.round(1450 * k) + 50);
  };
  const pausedRef = useRef(false);
  const pendingAiRef = useRef(false);
  const aiRunRef = useRef(0);
  const winsRef = useRef({});
  const lastRoundWinnerIdsRef = useRef([]); // 上一局獲勝者 id，下一局先手
  const clearWinsNextRef = useRef(false); // 整場結束後下一局須清空月亮標記
  const takenCardRef = useRef(null);
  const takenSlotRef = useRef(null);
  // 需選目標／確認的牌：C 區展示延到按確認後才 push，避免預先露出手牌
  const pendingArenaCardRef = useRef(null);
  const HUMAN_PENDING_ARENA_TYPES = useMemo(() => new Set([
    'DRUNKARD', 'VILLAGER', 'ASSASSIN', 'SEER', 'TAX_COLLECTOR', 'INQUISITOR',
    'BARKEEPER', 'GIRL', 'THIEF', 'PICKPOCKET', 'SWAP_HAND', 'WITCH',
    'BOUNTY_HUNTER', 'GRAVEDIGGER', 'NIGHT_WATCHMAN',
  ]), []);
  const reserveDrawRef = useRef(null); // 牌庫最後一張月亮牌翻開後，欠一次「從備用牌抽」的玩家 id
  const longPressRef = useRef(null); // 手牌長按計時器
  const lastTapRef = useRef(null);   // 雙點出牌：上一次點的手牌與時間
  const [zoomCard, setZoomCard] = useState(null); // 長按放大顯示的手牌
  const dragRef = useRef(null);   // 手牌拖曳中的資料
  const arenaRef = useRef(null);  // C 區（放開即出牌的區域）
  const [dragGhost, setDragGhost] = useState(null);
  const [viewPlayerId, setViewPlayerId] = useState(null);
  const gameOverRef = useRef(false);
  const victoryLocalRef = useRef(false);   // 本機觸發的結算（不需等遠端終局動畫的寬限）
  const gameRoundRef = useRef(0);          // 目前牌局所屬的 round
  const resolveRef = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { players, playerHands, deck, reserveCards, centerCards, moonPhase, extraTurnPlayerId, currentTurnIndex, witchTargetOwner };
  const humanPlayerId = onlineSession && firebaseUser
    ? ((players.find(p => p.uid === firebaseUser.uid) || {}).id ?? 0)
    : 0;
  humanIdRef.current = humanPlayerId;
  const humanPlayerName = (players.find(p => p.id === humanPlayerId) || {}).name || '你';
  // D／E 其他玩家顯示序：由左至右＝下一位 ➜ … ➜ 上一位（自己不顯示；最右＝上家、最左＝下家）
  const otherPlayersOrdered = (() => {
    const list = Array.isArray(players) ? players : [];
    const n = list.length;
    if (n <= 1) return [];
    const myIdx = list.findIndex(p => p.id === humanPlayerId);
    if (myIdx < 0) return list.filter(p => p.id !== humanPlayerId);
    const ordered = [];
    for (let i = 1; i < n; i++) ordered.push(list[(myIdx + i) % n]);
    return ordered;
  })();
  const canonicalizePlayerText = value => {
    const text = String(value ?? '');
    return !onlineSession || humanPlayerName === '你' ? text : text.replace(/你/g, humanPlayerName);
  };
  const setBroadcastAction = value => {
    setBroadcastActionRaw(canonicalizePlayerText(value));
    setBroadcastReveal('');
    setBroadcastEvent(null);
    setBroadcastPrivate(null);
  };
  // 扒手公開可顯示「秘密交換了 A 與 B 的手牌」；僅含牌面細節才遮罩
  const PRIVATE_TEXT_PATTERN = /秘密檢視結果|手牌為|手牌交換成功.*(?:你 取得|你 換出)|你 (?:取得|換出) \(\d+\)【|從暗牌 \d 拿到\(\d+\)【|放回\(\d+\)【|奪取其手牌.*你 取得|(?:抽到|抽牌到)\(\d+\)【|｜你 換出/;
  const sanitizePublicText = value => {
    const text = String(value ?? '');
    if (/秘密交換了 \S+ 與 \S+ 的手牌/.test(text)) {
      const pub = text.split('｜')[0].trim();
      return pub || text;
    }
    return PRIVATE_TEXT_PATTERN.test(text)
      ? '➔ 私密行動已完成'
      : text;
  };
  const setBroadcastResult = value => setBroadcastResultRaw(canonicalizePlayerText(sanitizePublicText(value)));
  const setPrivateBroadcast = (playerId, action, result, reveal = '') => setBroadcastPrivate({
    playerIds: [playerId],
    action: canonicalizePlayerText(action),
    result: `➔ ${canonicalizePlayerText(result)}`,
    reveal: canonicalizePlayerText(reveal),
  });
  const isMyTurn = onlineSession
    ? !!(players[currentTurnIndex] && players[currentTurnIndex].uid === (firebaseUser && firebaseUser.uid))
    : !!(players[currentTurnIndex] && !players[currentTurnIndex].isAI);

  // 洗牌算法
  const shuffle = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // 效果動畫：本機排序佇列；點擊才進下一個；不影響其他玩家／遊戲時長
  // 本機顯示一筆動畫（sticky 停住等點；非 sticky 播完可自動推進佇列）
  const presentLocalFx = (f, extendFlow = true) => {
    clearTimeout(fxTimerRef.current);
    fxCurRef.current = f;
    fxShownRef.current = !!f.sticky;
    // 遠端 fxEvent 也走這裡：更新播放截止時間，讓非房主能等狼月／吸血鬼等終局動畫播完再顯示結算
    if (f && f.duration && extendFlow) {
      fxUntilRef.current = Math.max(fxUntilRef.current || 0, Date.now() + f.duration);
    }
    setFx(f);
    // 非 sticky：播完後自動嘗試播佇列下一個（或關閉）
    if (!f.sticky) {
      const life = Math.max(800, (f.duration || 0) + (f.hold || 0));
      fxTimerRef.current = setTimeout(() => {
        if (!fxCurRef.current || fxCurRef.current.key !== f.key) return;
        const nxt = fxQueueRef.current.shift();
        if (nxt) presentLocalFx(nxt, false);
        else {
          fxCurRef.current = null;
          fxShownRef.current = false;
          setFx(null);
        }
      }, life + 60);
    }
  };
  presentLocalFxRef.current = presentLocalFx;
  const startFx = (f0, publicFx = null) => {
    if (!f0 || !f0.kind) return;
    // 動畫在本機停在最後一格等點擊；遊戲流程只等待實際播放時長，不等待點擊。
    // 全屏（月亮／咬鏡頭／吸血鬼）與其他動畫相同：播完 sticky 等點才關；對局中不可提前略過。
    const sticky = f0.kind !== 'none';
    const f = { ...f0, duration: Math.round(f0.duration * slow()), hold: sticky ? 0 : Math.round(fxHold(f0) * slow()), sticky };
    const sharedPublic = publicFx
      ? { ...publicFx, key: f.key, duration: f.duration, hold: f.hold, sticky }
      : (f.privateTo?.length ? null : { ...f, key: f.key, duration: f.duration, hold: f.hold, sticky });
    // 私密動畫同步時不帶 mine：每位客戶端依 drunkMeta／swapMeta + 自己的 localPlayerId 解析換出／換入，避免全員看到出牌者的牌面
    const sharedPrivate = f.privateTo?.length
      ? (() => {
          const { mine: _omitMine, ...rest } = f;
          return { ...rest, key: f.key, duration: f.duration, hold: f.hold, sticky, privateTo: f.privateTo };
        })()
      : null;
    // 權威流程計時：永遠以「這次動作」的播放時長為準（與本機是否排隊無關）
    fxUntilRef.current = Date.now() + f.duration;
    fastRef.current = false;
    // 線上：推公開 fx；若有私密動畫一併帶 privateFx，各客戶端依 privateTo 自行取用
    if (onlineSession && roomCode && firebaseUser && (sharedPublic || sharedPrivate)) {
      const event = JSON.parse(JSON.stringify({
        key: f.key,
        sourceUid: firebaseUser.uid,
        fx: sharedPublic,
        privateFx: sharedPrivate,
      }));
      firebase.database().ref(`rooms/${roomCode}/gameState/fxEvent`).set(event).catch(error => {
        console.error('動畫同步失敗：', error);
        setLobbyError(`動畫同步失敗：${error.message}`);
      });
    }
    // 私密動畫若不是給本機玩家看的：只同步給別人，本機不顯示（否則會變成看不到、點不掉、還擋住後續動畫佇列）
    if (f.privateTo?.length && !f.privateTo.includes(humanIdRef.current)) return;
    // 本機已有動畫在播或停住 → 排隊；否則立即播放
    if (fxCurRef.current || fxShownRef.current) {
      fxQueueRef.current.push(f);
      return;
    }
    presentLocalFx(f);
  };
  // 遊戲結束畫面：終局動畫（狼月／吸血鬼／比點／第3月亮）必須「本機點擊關閉」後才顯示勝利視窗。
  // 非房主可能先收到 gameOver、後收到 fxEvent，故保留短暫寬限讓終局動畫有機會開始。
  useEffect(() => {
    if (!gameOver) { setVictoryReady(false); return; }
    let cancelled = false;
    const gameOverAt = Date.now();
    const isFinale = (f) => !!(f && (
      f.kind === 'wolfbite' || f.kind === 'vampire' || f.kind === 'score' || f.kind === 'match' ||
      (f.kind === 'moon' && (Number(f.phase) >= 3 || f.wolf === 'held'))
    ));
    // 佇列瘦身：保留終局動畫＋最後一筆（致命一擊）；不再清掉「正在播」的動畫
    const trimQueue = () => {
      const q = fxQueueRef.current;
      let lastIdx = -1;
      q.forEach((f, i) => { if (!isFinale(f)) lastIdx = i; });
      fxQueueRef.current = q.filter((f, i) => isFinale(f) || i === lastIdx);
    };
    const clearAllFx = () => {
      clearTimeout(fxTimerRef.current);
      fxQueueRef.current = [];
      fxCurRef.current = null;
      fxShownRef.current = false;
      setFx(null);
    };
    const expectScoreKey = (winnerInfo && ((winnerInfo.scores && winnerInfo.scores.fxKey) || winnerInfo.matchFxKey)) || null;
    const tryReady = () => {
      if (cancelled) return;
      const now = Date.now();
      const cur = fxCurRef.current;
      // 佇列中還有非終局動畫 → 先播完再處理終局
      if (fxQueueRef.current.length) {
        const hasNonFinale = fxQueueRef.current.some(f => f && !isFinale(f));
        if (hasNonFinale || (cur && !isFinale(cur) && now < (fxUntilRef.current || 0) + 250)) {
          if (now >= (fxUntilRef.current || 0) + 250 && !isFinale(cur)) {
            const piece = fxQueueRef.current.shift();
            if (piece && presentLocalFxRef.current) presentLocalFxRef.current(piece);
          }
          setTimeout(tryReady, 150);
          return;
        }
      }
      // 找出本局終局動畫 key（優先 scores.fxKey，否則目前／佇列中的終局）
      let finaleKey = expectScoreKey;
      if (!finaleKey) {
        if (cur && isFinale(cur) && cur.key) finaleKey = cur.key;
        else {
          const qf = fxQueueRef.current.find(f => f && isFinale(f) && f.key);
          if (qf) finaleKey = qf.key;
        }
      }
      if (finaleKey) {
        // 必須本機點擊關閉該終局動畫後才開勝利視窗
        if (scoreDoneKeysRef.current.has(finaleKey)) {
          clearAllFx();
          setVictoryReady(true);
          return;
        }
        // 若終局還在佇列、目前沒在播 → 拉出來播
        // 但若目前正在播另一段終局（例如最終比點），不可打斷；等玩家點掉後由 skipFx 播佇列中的集滿標記
        if (!(cur && cur.key === finaleKey)) {
          if (!(cur && isFinale(cur))) {
            const idx = fxQueueRef.current.findIndex(f => f && f.key === finaleKey);
            if (idx >= 0) {
              const piece = fxQueueRef.current.splice(idx, 1)[0];
              if (piece && presentLocalFxRef.current) presentLocalFxRef.current(piece);
            }
          }
        }
        // 動畫遲遲未到（非房主等 fxEvent）：寬限後仍無則直接開視窗，避免卡死
        const seen = (cur && cur.key === finaleKey) || fxQueueRef.current.some(f => f && f.key === finaleKey) || scoreDoneKeysRef.current.has(finaleKey);
        if (!seen && now - gameOverAt > 14000) {
          clearAllFx();
          setVictoryReady(true);
          return;
        }
        setTimeout(tryReady, 200);
        return;
      }
      // 尚無終局 key：等播放時長／fxEvent；非本機觸發給一點寬限
      if (now < (fxUntilRef.current || 0) + 250) {
        setTimeout(tryReady, 120);
        return;
      }
      if (!victoryLocalRef.current && now - gameOverAt < 4500) {
        setTimeout(tryReady, 120);
        return;
      }
      // 沒有終局動畫（例如唯一存活直接結束）→ 可開視窗
      clearAllFx();
      setVictoryReady(true);
    };
    const t = setTimeout(() => {
      trimQueue();
      tryReady();
    }, 400);
    // 安全上限：有終局動畫時不強制關（等點擊）；無 key 時約 18 秒後仍顯示，避免永遠卡住
    const force = setTimeout(() => {
      if (cancelled) return;
      // 若畫面上仍有終局動畫且玩家還沒點，不要硬關動畫本體；只在完全沒有終局時才強制開視窗
      const cur = fxCurRef.current;
      if (cur && isFinale(cur) && cur.key && !scoreDoneKeysRef.current.has(cur.key)) return;
      clearAllFx();
      setVictoryReady(true);
    }, 18000);
    return () => { cancelled = true; clearTimeout(t); clearTimeout(force); };
  }, [gameOver]);
  // 動態區可重播最近一筆效果動畫
  const [lastBroadcastFx, setLastBroadcastFx] = useState(null);
  const historyWasOpenForReplayRef = useRef(false);
  // 點行動紀錄 ➔ 關閉紀錄視窗，回放該筆動畫（純視覺，不影響遊戲）
  const playLogFx = (f) => {
    historyWasOpenForReplayRef.current = true;
    setIsHistoryModalOpen(false);
    setReplay(r => ({ fx: f, n: (r ? r.n : 0) + 1 }));
  };
  const playBroadcastFx = () => {
    if (!lastBroadcastFx) return;
    historyWasOpenForReplayRef.current = false;
    setReplay(r => ({ fx: lastBroadcastFx, n: (r ? r.n : 0) + 1 }));
  };
  // 回放結束：若從紀錄進來則回到紀錄彈窗
  const closeReplay = () => {
    setReplay(null);
    if (historyWasOpenForReplayRef.current) setIsHistoryModalOpen(true);
    historyWasOpenForReplayRef.current = false;
  };
  useEffect(() => {
    if (!replay || !replay.fx) return;
    if (['moon', 'wolfbite', 'vampire', 'score', 'match'].includes(replay.fx.kind)) return; // 全屏動畫回放：播完停住，點一下離開
    const t = setTimeout(() => closeReplay(), (replay.fx.duration || 4000) + fxHold(replay.fx) + 500);
    return () => clearTimeout(t);
  }, [replay]);
  // 等待器：至少等 minMs，且效果動畫（fxUntilRef）播完才執行 fn；本機略過時可提前解除。
  // useFast：若剛略過動畫，這次等待直接歸零（下一位 AI 立即行動）。回傳取消函式。
  const waitersRef = useRef(new Set());
  const whenFxDone = (fn, minMs = 0, useFast = false) => {
    if (useFast && fastRef.current) { fastRef.current = false; minMs = 0; }
    const w = { done: false, timer: null };
    const t0 = Date.now();
    w.run = () => {
      if (w.done) return;
      w.done = true;
      clearTimeout(w.timer);
      waitersRef.current.delete(w);
      fn();
    };
    const tick = () => {
      if (w.done) return;
      const fxEnd = 0; // 流程不再等動畫播完：打出手牌後立即換人，動畫各客戶端自行排隊播放
      const rest = Math.max(t0 + minMs, fxEnd) - Date.now();
      if (rest <= 0) w.run(); else w.timer = setTimeout(tick, Math.min(rest, 150));
    };
    waitersRef.current.add(w);
    w.timer = setTimeout(tick, 0);
    return () => { w.done = true; clearTimeout(w.timer); waitersRef.current.delete(w); };
  };
  const skipFx = () => {
    clearTimeout(fxTimerRef.current);
    {
      const done = fxCurRef.current;
      // 終局動畫（比點／狼月／吸血鬼／第3月亮）點擊後記入，勝利視窗才可出現
      if (done && done.key && (
        done.kind === 'score' || done.kind === 'wolfbite' || done.kind === 'vampire' || done.kind === 'match' ||
        (done.kind === 'moon' && (Number(done.phase) >= 3 || done.wolf === 'held'))
      )) {
        scoreDoneKeysRef.current.add(done.key);
      }
    }
    // 點擊只關閉本機目前動畫；有排隊則播下一個（不影響其他玩家、不改權威流程）
    const nxt = fxQueueRef.current.shift();
    if (nxt) {
      presentLocalFx(nxt, false); // 本機點擊只換畫面，不延長權威流程等待
      return;
    }
    fxCurRef.current = null;
    fxShownRef.current = false;
    // 不強制清零 fxUntilRef、也不觸發 waiters：遊戲流程只依各動作的 duration 推進
    setFx(null);
  };
  // 統一更新廣播與紀錄
  const logActionAndResult = (actionText, resultText, playerName = '系統', event = null, reveal = '', visibility = null) => {
    const fullAction = canonicalizePlayerText(actionText);
    const fullResult = canonicalizePlayerText(resultText);
    const fullReveal = canonicalizePlayerText(reveal);
    playerName = canonicalizePlayerText(playerName);
    const publicAction = canonicalizePlayerText(sanitizePublicText(visibility?.publicAction ?? actionText));
    const publicResult = canonicalizePlayerText(sanitizePublicText(visibility?.publicResult ?? resultText));
    const publicReveal = canonicalizePlayerText(sanitizePublicText(visibility?.publicReveal ?? (visibility ? '' : reveal)));
    const privateView = visibility?.privateTo?.length
      ? {
          playerIds: visibility.privateTo,
          action: fullAction,
          result: fullResult,
          reveal: fullReveal,
          ...(visibility.swapMeta ? { swapMeta: visibility.swapMeta } : {}),
          ...(visibility.drunkMeta ? { drunkMeta: visibility.drunkMeta } : {}),
        }
      : null;
    setBroadcastAction(publicAction);
    setBroadcastResult(`➔ ${publicResult}`);
    if (publicReveal) setBroadcastReveal(publicReveal);
    // 動態私密行：swap／醉漢只顯示「你」換出／取得
    let broadcastPrivateResult = privateView ? privateView.result : null;
    if (privateView?.swapMeta) {
      broadcastPrivateResult = formatSwapResultForViewer(
        privateView.result.split('｜')[0],
        privateView.swapMeta,
        humanPlayerId
      );
    } else if (privateView?.drunkMeta) {
      broadcastPrivateResult = formatDrunkResultForViewer(
        privateView.result.split('｜')[0],
        privateView.drunkMeta,
        humanPlayerId
      );
    }
    setBroadcastPrivate(privateView ? {
      playerIds: privateView.playerIds,
      action: privateView.action,
      result: `➔ ${broadcastPrivateResult}`,
      reveal: privateView.reveal,
      ...(privateView.swapMeta ? { swapMeta: privateView.swapMeta } : {}),
      ...(privateView.drunkMeta ? { drunkMeta: privateView.drunkMeta } : {}),
    } : null);
    if (event) setBroadcastEvent({ type: event, key: `${Date.now()}-${Math.random()}` });
    // 效果動畫：由動作行與結果行推導（純視覺；解析失敗就不播），並存進紀錄供回放
    let publicFx = null;
    let privateFx = null;
    if (!gameOverRef.current) {
      try {
        publicFx = deriveFx(publicAction, publicResult, publicReveal, stateRef.current);
        if (!visibility) publicFx = deriveFx(fullAction, fullResult, fullReveal, stateRef.current);
      } catch (e) { console.warn('fx error', e); }
    }
    if (visibility?.privateFx && visibility.privateTo?.length) {
      const hasHumanViewer = visibility.privateTo.some(id => {
        const recipient = stateRef.current.players.find(player => player.id === id);
        return recipient && !recipient.isAI;
      });
      if (hasHumanViewer && !gameOverRef.current) {
        try { privateFx = deriveFx(fullAction, fullResult, fullReveal, stateRef.current); } catch (e) { console.warn('private fx error', e); }
        if (privateFx) {
          privateFx.privateTo = visibility.privateTo;
          privateFx.key = (publicFx || privateFx).key;
          if (visibility.swapMeta) {
            privateFx.swapMeta = visibility.swapMeta;
            const me = visibility.swapMeta.parties.find(p => p.id === humanPlayerId);
            if (me && me.out && me.in) privateFx.mine = { out: me.out, in: me.in };
          }
          if (visibility.drunkMeta) {
            privateFx.drunkMeta = visibility.drunkMeta;
            const me = visibility.drunkMeta.parties.find(p => p.id === humanPlayerId);
            if (me && (me.out || me.in)) privateFx.mine = { out: me.out, in: me.in };
          }
        }
      }
    }
    const localFx = privateFx || publicFx;
    setHistoryLogs(prev => [
      {
        id: `${Date.now()}-${Math.random()}`,
        player: playerName,
        action: publicAction,
        result: publicResult,
        reveal: publicReveal,
        privateView,
        event,
        card: `${publicAction} ➔ ${publicResult}`,
        fx: publicFx,
        privateFx,
      },
      ...prev
    ]);
    // skipFx：只寫動態／紀錄（如先知），不播放效果動畫
    if (localFx && !visibility?.skipFx) {
      startFx(localFx, publicFx);
      setLastBroadcastFx(localFx);
    } else if (publicFx) {
      setLastBroadcastFx(publicFx);
    }
  };

  // 暗牌追蹤：某人對某一格「拿一還一」（看過 + 換過）
  const metaApplySwap = (slot, pid, placed) => {
    setCenterMeta(prev => prev.map((m, i) => i !== slot ? m : {
      viewedBy: m.viewedBy.includes(pid) ? m.viewedBy : [...m.viewedBy, pid],
      swappedBy: m.swappedBy.includes(pid) ? m.swappedBy : [...m.swappedBy, pid],
      knownBy: {
        ...Object.fromEntries(Object.entries(centerKnowledge(m)).map(([ownerId, knowledge]) => [ownerId, { ...knowledge, stale: true }])),
        ...(pid === humanPlayerId ? { [pid]: { card: placed, stale: false } } : {}),
      },
      myCard: pid === humanPlayerId ? placed : m.myCard,
      myCardOwnerId: pid === humanPlayerId ? pid : m.myCardOwnerId,
      myStale: pid === humanPlayerId ? false : (m.myCard ? true : m.myStale),
    }));
    if (pid !== humanPlayerId) {
      setCenterKnownSet(null);
      setWatchNote(prev => {
        if (!prev) return prev;
        const notes = prev.byPlayer
          ? { ...prev.byPlayer }
          : (prev.ownerId !== undefined ? { [prev.ownerId]: prev } : {});
        Object.keys(notes).forEach(ownerId => { notes[ownerId] = { ...notes[ownerId], stale: true }; });
        return { byPlayer: notes };
      });
    }
  };

  // 暗牌追蹤：守夜人看過 3 張、換過 1 張並洗勻（公開只知「看過3、換過1、不知哪一格」）
  // 玩家本人用守夜人時，會知道洗勻後每一格是什麼牌（shuffled），並留下換出／換入的私人備註
  const metaWatchman = (pid, shuffled, note) => {
    setCenterMeta(prev => prev.map((m, i) => ({
      ...m,
      knownBy: {
        ...Object.fromEntries(Object.entries(centerKnowledge(m)).map(([ownerId, knowledge]) => [ownerId, { ...knowledge, stale: true }])),
        ...(pid === humanPlayerId ? { [pid]: { card: (shuffled || [])[i] || null, stale: false } } : {}),
      },
      myCard: pid === humanPlayerId ? ((shuffled || [])[i] || null) : m.myCard,
      myCardOwnerId: pid === humanPlayerId ? pid : m.myCardOwnerId,
      myStale: pid === humanPlayerId ? false : (m.myCard ? true : m.myStale),
    })));
    setWatchLog(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, pid }]);
    setWatchNote(prev => {
      const notes = prev && prev.byPlayer
        ? { ...prev.byPlayer }
        : (prev && prev.ownerId !== undefined ? { [prev.ownerId]: prev } : {});
      Object.keys(notes).forEach(ownerId => { notes[ownerId] = { ...notes[ownerId], stale: true }; });
      if (pid === humanPlayerId) notes[pid] = { ownerId: pid, text: note || '', stale: false };
      return { byPlayer: notes };
    });
    setCenterKnownSet(null);
  };

  // AI 的「拿一還一」：隨機拿一格暗牌；優先放回市長，其次放回數值較小的非狼人牌；之後結束回合
  // AI 出牌選擇：優先打出非市長、非狼人的牌
  const aiPickCard = (hand) => hand.find(c => c?.type && c.type !== 'WEREWOLF' && c.type !== 'MAYOR') || hand[0];

  const aiCenterSwap = (pid) => {
    const st = stateRef.current;
    const slots = st.centerCards.map((c, i) => c ? i : -1).filter(i => i >= 0);
    const handNow = (st.playerHands[pid] || []).filter(Boolean);
    if (slots.length === 0 || handNow.length !== 1) return false;
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const taken = st.centerCards[slot];
    const two = [...handNow, taken];
    let ret = two.find(c => c.type === 'MAYOR');
    if (!ret) ret = two.filter(c => c.type !== 'WEREWOLF').sort((a, b) => a.value - b.value)[0];
    if (!ret) ret = two[0];
    const keep = two.find(c => c.id !== ret.id) || ret;
    const newCenter = [...st.centerCards];
    newCenter[slot] = ret;
    stateRef.current.centerCards = newCenter;
    setCenterCards(newCenter);
    setHandNow(pid, [keep]);
    metaApplySwap(slot, pid, ret);
    const name = st.players.find(p => p.id === pid).name;
    logActionAndResult(
      `${name} 執行【拿一還一】`,
      `替換了 1 張中央暗牌（暗牌 ${slot + 1}）➔ 中央暗牌維持 3 張`,
      name,
      null,
      '',
      {
        privateTo: [pid],
        privateFx: true,
        publicAction: `${name} 執行【拿一還一】`,
        // 公開：只告訴大家哪一格被拿起放回（不露牌面），讓其他玩家能播 takeone 動畫
        publicResult: `暗牌 ${slot + 1} 被拿起並放回 ➔ 中央暗牌維持 3 張`,
      }
    );
    if (wolfWinAfterSwap(pid, [keep])) return true; // 第 3 張月亮後把狼人留在手上 ➔ 立刻獲勝
    advanceTurn();
    return true;
  };

  // 玩家（人類）換到新手牌時，列出取得的牌（僅限自己；AI 取得的牌不公開）
  // 比大小（酒保／小女孩）輸家公開手牌：與 eliminatePlayer 內的公開文字完全相同（寫入時會自動去重）
  const cmpReveal = (p, c) => `${p.name} 公開手牌：${c ? `(${c.value})【${c.title}】` : '無'}`;
  const gotCardsText = (hand, oldHand) => {
    const fmt = (arr) => arr.map(c => `(${c.value})【${c.title}】`).join('、');
    const cs = (hand || []).filter(Boolean);
    const os = (oldHand || []).filter(Boolean);
    if (!cs.length) return os.length ? `｜你 換出 ${fmt(os)}` : '';
    return os.length ? `｜你 換出 ${fmt(os)}、取得 ${fmt(cs)}` : `｜你 取得 ${fmt(cs)}`;
  };
  // 扒手：結構化雙方換牌（紀錄／動畫只對指定玩家顯示「你」的換出／取得）
  const cardSnap = (c) => {
    if (!c) return null;
    const meta = [...BASE_CARDS_DEF, WEREWOLF_CARD].find(m => m.title === c.title);
    return { value: c.value, title: c.title, icon: c.icon || (meta && meta.icon) };
  };
  const buildSwapMeta = (a, aOld, b, bOld) => ({
    parties: [
      { id: a.id, name: a.name, out: cardSnap((aOld || []).filter(Boolean)[0]), in: cardSnap((bOld || []).filter(Boolean)[0]) },
      { id: b.id, name: b.name, out: cardSnap((bOld || []).filter(Boolean)[0]), in: cardSnap((aOld || []).filter(Boolean)[0]) },
    ],
  });
  const formatSwapResultForViewer = (base, swapMeta, viewerId) => {
    if (!swapMeta || !Array.isArray(swapMeta.parties)) return base;
    const me = swapMeta.parties.find(p => p.id === viewerId);
    const names = swapMeta.parties.map(p => p.name);
    const head = base || `秘密交換了 ${names[0]} 與 ${names[1]} 的手牌`;
    if (!me) return head;
    const fmt = (c) => (c ? `(${c.value})【${c.title}】` : '無');
    return `${head}｜你 換出 ${fmt(me.out)}、取得 ${fmt(me.in)}`;
  };
  // 醉漢：每位參與者只看自己的換出／取得
  const formatDrunkResultForViewer = (base, drunkMeta, viewerId) => {
    if (!drunkMeta || !Array.isArray(drunkMeta.parties)) return base;
    const me = drunkMeta.parties.find(p => p.id === viewerId);
    const head = base || '全員手牌已重發';
    if (!me) return head;
    const fmt = (c) => (c ? `(${c.value})【${c.title}】` : '無');
    if (me.out && me.in) return `${head}｜你 換出 ${fmt(me.out)}、取得 ${fmt(me.in)}`;
    if (me.in) return `${head}｜你 取得 ${fmt(me.in)}`;
    if (me.out) return `${head}｜你 換出 ${fmt(me.out)}`;
    return head;
  };

  // 按照規則初始化準備遊戲（三層牌庫結構）
  const initGame = (roster = INITIAL_PLAYERS) => {
    setGameReady(false);
    // 新局前作廢任何在飛的舊局發布（舊 transaction 回來時 publishGen 不符則丟棄）
    publishGenRef.current += 1;
    publishInFlightRef.current = false;
    publishDirtyRef.current = false;
    publishRetryRef.current = 0;
    if (gameSyncTimerRef.current) {
      clearTimeout(gameSyncTimerRef.current);
      gameSyncTimerRef.current = null;
    }
    gameRevisionRef.current = 0; turnSeqRef.current = 0;
    lastActorUidRef.current = null;
    victoryLocalRef.current = false;
    scoreDoneKeysRef.current = new Set();
    gameRoundRef.current = (roomData && roomData.round) || 0;
    let base29 = [];
    let idCounter = 0;
    BASE_CARDS_DEF.forEach(c => {
      for (let i = 0; i < c.totalCount; i++) {
        base29.push({ ...c, id: `card-${idCounter++}-${Math.random().toString(36).substr(2, 4)}` });
      }
    });
    base29 = shuffle(base29);

    const hands = {};
    roster.forEach(p => {
      hands[p.id] = [base29.pop()];
    });

    const reserves = [base29.pop(), base29.pop()];
    const center = [base29.pop(), base29.pop(), base29.pop()];

    const chunkSize = Math.floor(base29.length / 3);
    let bottomTier = base29.slice(0, chunkSize);
    let middleTier = base29.slice(chunkSize, chunkSize * 2);
    let topTier = base29.slice(chunkSize * 2);

    const wolfMoon = { ...MOON_CARDS[2], id: `moon-3-${Math.random().toString(36).substr(2, 4)}` };
    const howlMoon = { ...MOON_CARDS[1], id: `moon-2-${Math.random().toString(36).substr(2, 4)}` };
    const loneMoon = { ...MOON_CARDS[0], id: `moon-1-${Math.random().toString(36).substr(2, 4)}` };

    bottomTier = shuffle([...bottomTier, wolfMoon]);
    const werewolfCard = { ...WEREWOLF_CARD, id: `werewolf-${Math.random().toString(36).substr(2, 4)}` };
    // 狼人角色牌改洗入上層（見下方）

    middleTier = shuffle([...middleTier, howlMoon]);
    // 牌庫以陣列尾端為頂（pop 抽牌），陣列最前面 = 該層最底。
    // 上層：6 張普通牌 + 狼人洗勻，孤狼月亮放在上層最底 ➔ 狼人必在第 1 張月亮之前出現
    topTier = [loneMoon, ...shuffle([...topTier, werewolfCard])];

    const finalDeck = [...bottomTier, ...middleTier, ...topTier];

    setDeck(finalDeck);
    setReserveCards(reserves);
    setCenterCards(center);
    setCenterMeta([0, 1, 2].map(makeCenterMeta));
    setCenterKnownSet(null);
    setWatchLog([]);
    setWatchNote(null);
    setVictoryDismissed(false);
    setCenterPickMode(false);
    setPickSlot(null);
    takenCardRef.current = null;
    takenSlotRef.current = null;
    setPlayerHands(hands);
    setPlayers(roster.map(p => ({ ...p, status: '存活', protected: false, playedCards: [], witchRevived: false, handTaken: false })));
    // 整場結束後開新的一場：重置所有月亮標記
    if (clearWinsNextRef.current) {
      clearWinsNextRef.current = false;
      winsRef.current = {};
      setWins({});
    }
    // 上一局勝利玩家先出牌（多人共同獲勝時取名單中第一位仍在本局 roster 者）
    const prevWinners = (lastRoundWinnerIdsRef.current || []).filter(id => roster.some(p => p.id === id));
    let startTurn = 0;
    if (prevWinners.length) {
      const idx = roster.findIndex(p => p.id === prevWinners[0]);
      startTurn = idx >= 0 ? idx : 0;
    }
    setCurrentTurnIndex(startTurn);
    setMoonPhase(0);
    setGameOver(false);
    setWinnerInfo(null);
    gameOverRef.current = false;
    lockRef.current = false;
    reserveDrawRef.current = null;
    setZoomCard(null);
    setActionLocked(false);
    setPlayedCardArena(null);
    setRecentArenaCards([]);
    pendingArenaCardRef.current = null;
    setArenaFanOpen(false);
    setArenaFocus(null);
    clearTimeout(fxTimerRef.current);
    fxUntilRef.current = 0;
    setReplay(null);
    setSeerSeen(null);
    setDrunkSeen(null);
    fxQueueRef.current = [];
    fxCurRef.current = null;
    fxShownRef.current = false;
    setFx(null);
    setWitchTargetOwner(null);
    setIsReturningCenterCard(false);
    setExtraTurnPlayerId(null);

    const starter = roster[startTurn];
    const starterName = starter ? starter.name : '';
    const startHint = prevWinners.length && starter
      ? `➔ 上一局勝者【${starterName}】先出牌；狼人已潛伏在牌庫頂層`
      : '➔ 狼人已潛伏在牌庫頂層';
    setBroadcastAction('《狼月》牌庫準備完畢！');
    setBroadcastResult(startHint);
    setHistoryLogs([{ id: Date.now(), player: '系統', card: prevWinners.length && starter
      ? `《狼月》牌庫準備完畢！上一局勝者【${starterName}】先出牌。狼人已潛伏在頂層。`
      : '《狼月》牌庫準備完畢！狼人已潛伏在頂層。' }]);
    setGameReady(true);
  };

  useEffect(() => {
    if (screen !== 'game') return;
    if (onlineSession) {
      const isHost = !!(roomData && firebaseUser && roomData.hostUid === firebaseUser.uid);
      if (!isHost) return;
      if (roomData && roomData.status && roomData.status !== 'playing') return;
      // 尚無牌局（開局／全員準備後 gameState 被清成 null）➔ 房主發牌
      const already = !!(roomData && roomData.gameState && roomData.gameState.revision > 0);
      if (already) return;
      const roster = roomData && roomData.gamePlayers ? roomData.gamePlayers : INITIAL_PLAYERS;
      initGame(roster);
      // 若首次發布失敗（網路／transaction），2 秒後再試一次，避免 Guest 永久停在「等待房主發牌」
      const retry = setTimeout(() => {
        // init 成功並寫入後 gameRevisionRef ≥ 1；仍為 0 代表尚未成功發布
        if (gameRevisionRef.current > 0) return;
        gameRevisionRef.current = 0;
        initGame(roster);
      }, 2000);
      // 再保險：6 秒後若仍無 revision，再試一次（Guest 卡在同步畫面時多半是房主沒寫成功）
      const retry2 = setTimeout(() => {
        if (gameRevisionRef.current > 0) return;
        gameRevisionRef.current = 0;
        initGame(roster);
      }, 6000);
      return () => { clearTimeout(retry); clearTimeout(retry2); };
    }
    initGame(INITIAL_PLAYERS);
  }, [screen, onlineSession, roomData && roomData.round, roomData && roomData.hostUid, roomData && roomData.status, roomData && !!(roomData.gameState && roomData.gameState.revision > 0), firebaseUser]);

  // 新局／開局：gameState 為 null 時重置 revision；非房主清空桌面等房主發牌；房主也歸零 revision 以便 initGame 發布
  useEffect(() => {
    if (!onlineSession || screen !== 'game' || !roomData || !firebaseUser) return;
    if (roomData.gameState) return;
    // 任何客戶端：新局清空期間作廢舊 revision／在飛發布，避免卡在「等待房主發牌」或把上局寫回
    gameRevisionRef.current = 0; turnSeqRef.current = 0;
    publishGenRef.current += 1;
    publishInFlightRef.current = false;
    publishDirtyRef.current = false;
    publishRetryRef.current = 0;
    gameRoundRef.current = roomData.round || 0;
    victoryLocalRef.current = false;
    lastActorUidRef.current = null;
    gameOverRef.current = false;
    if (roomData.hostUid === firebaseUser.uid) return; // 房主由 initGame 負責桌面，此處只歸零序號
    // 先清空本機桌面；勝場以房主下一份快照為準（整場結束會是 {}，中場下一局會帶累計）
    winsRef.current = {};
    scoreDoneKeysRef.current = new Set();
    clearTimeout(fxTimerRef.current);
    fxUntilRef.current = 0;
    fxQueueRef.current = [];
    fxCurRef.current = null;
    fxShownRef.current = false;
    lockRef.current = false;
    pendingArenaCardRef.current = null;
    reserveDrawRef.current = null;
    unstable_batchedUpdates(() => {
      setGameReady(false);
      setGameOver(false);
      setWinnerInfo(null);
      setVictoryReady(false);
      setVictoryDismissed(false);
      setWins({});
      setFx(null);
      setReplay(null);
      setActionLocked(false);
      setInteractionModal(null);
      setPlayers([]);
      setPlayerHands({});
      setDeck([]);
      setReserveCards([]);
      setCenterCards([]);
      setCenterMeta([0, 1, 2].map(makeCenterMeta));
      setWatchLog([]);
      setWatchNote(null);
      setPlayedCardArena(null);
      setRecentArenaCards([]);
      setArenaFanOpen(false);
      setArenaFocus(null);
      setMoonPhase(0);
      setCurrentTurnIndex(0);
      setExtraTurnPlayerId(null);
      setWitchTargetOwner(null);
      setSeerSeen(null);
      setDrunkSeen(null);
      setSelectedHandCard(null);
      setZoomCard(null);
      setIsReturningCenterCard(false);
      setBroadcastAction('正在同步牌局…');
      setBroadcastResult('➔ 等待房主發牌');
      setBroadcastPrivate(null);
      setBroadcastReveal('');
      setBroadcastEvent(null);
      setHistoryLogs([]);
    });
  }, [onlineSession, screen, roomData && !roomData.gameState, roomData && roomData.round, roomData && roomData.hostUid, firebaseUser]);

  useEffect(() => {
    const snapshot = roomData && roomData.gameState;
    if (!onlineSession || screen !== 'game' || !firebaseUser || !snapshot) return;
    if (snapshot.sourceUid === firebaseUser.uid) return;
    // 新局偵測：round 不同代表換局（即使沒看到中間的 gameState=null），重置 revision 與本機動畫狀態
    const snapRound = snapshot.round || 0;
    let roundChanged = false;
    if (snapRound !== gameRoundRef.current) {
      roundChanged = true;
      gameRoundRef.current = snapRound;
      gameRevisionRef.current = 0; turnSeqRef.current = 0;
      lastActorUidRef.current = null;
      victoryLocalRef.current = false;
      clearTimeout(fxTimerRef.current);
      fxUntilRef.current = 0;
      fxQueueRef.current = [];
      fxCurRef.current = null;
      fxShownRef.current = false;
      setFx(null);
      setVictoryReady(false);
      setVictoryDismissed(false);
    }
    if (snapshot.revision <= gameRevisionRef.current) return;
    // 換局（round 變更）時一律套用房主新牌局，不做 turnSeq 拒絕（否則會留下上局手牌／C 區／勝場）
    // 同局回合權威：
    // 1) 本機 turnSeq 較新且仍握行動權 → 遠端是舊快照，不套用，只跟上 revision 並觸發本機再發布。
    // 2) 本機仍握有行動權且同 turnSeq、非本人寫入 → 不套用。
    // 3) 本機 turnSeq 較新但已無行動權 → 視為本機發布失敗的分叉，改以遠端為準（避免 Guest 永久卡死、讀不到之後行動）。
    if (!roundChanged) {
      const stLocal = stateRef.current;
      const hostOwns = !!(roomData && roomData.hostUid === firebaseUser.uid);
      const localPlayers = stLocal.players || [];
      const localActor = localPlayers[stLocal.currentTurnIndex];
      const iOwnLocalTurn = !!localActor && (
        localActor.isAI
          ? hostOwns
          : localActor.uid === firebaseUser.uid
      );
      const snapSeq = snapshot.turnSeq || 0;
      const localSeq = turnSeqRef.current || 0;
      if (localPlayers.length > 0 && snapSeq < localSeq) {
        if (iOwnLocalTurn) {
          gameRevisionRef.current = Math.max(gameRevisionRef.current, snapshot.revision);
          lockRef.current = false;
          setSyncTick(t => t + 1);
          return;
        }
        // 無行動權卻序號超前：放棄本機分叉，套用遠端
      }
      if (iOwnLocalTurn && localPlayers.length > 0) {
        if (snapSeq === localSeq && snapshot.sourceUid && snapshot.sourceUid !== firebaseUser.uid) {
          gameRevisionRef.current = snapshot.revision;
          lockRef.current = false;
          setSyncTick(t => t + 1);
          return;
        }
      }
    } else {
      scoreDoneKeysRef.current = new Set();
    }
    applyingRemoteGameRef.current = true;
    const incomingPlayers = Array.isArray(snapshot.players)
      ? snapshot.players
      : Object.values(snapshot.players || {});
    const normalizedPlayers = incomingPlayers.filter(Boolean).map((player, index) => {
      const template = INITIAL_PLAYERS[index % INITIAL_PLAYERS.length];
      return {
        ...template,
        ...player,
        status: player.status || '存活',
        protected: !!player.protected,
        playedCards: playedCardsOf(player),
      };
    });
    const incomingCenterMeta = Array.isArray(snapshot.centerMeta) ? snapshot.centerMeta : [];
    const normalizedCenterMeta = [0, 1, 2].map(index => {
      const meta = incomingCenterMeta[index] || {};
      return {
        ...makeCenterMeta(),
        ...meta,
        viewedBy: Array.isArray(meta.viewedBy) ? meta.viewedBy : [],
        swappedBy: Array.isArray(meta.swappedBy) ? meta.swappedBy : [],
        knownBy: centerKnowledge(meta),
        myCardOwnerId: meta.myCardOwnerId ?? null,
      };
    });
    gameRevisionRef.current = snapshot.revision;
    turnSeqRef.current = snapshot.turnSeq || 0;
    lastActorUidRef.current = normalizedPlayers[snapshot.currentTurnIndex]?.uid || null;
    victoryLocalRef.current = !!snapshot.gameOver;
    gameOverRef.current = !!snapshot.gameOver;
    winsRef.current = snapshot.wins || {};
    lockRef.current = false;
    stateRef.current = {
      players: normalizedPlayers,
      playerHands: snapshot.playerHands || {},
      deck: snapshot.deck || [],
      reserveCards: snapshot.reserveCards || [],
      centerCards: snapshot.centerCards || [],
      moonPhase: snapshot.moonPhase || 0,
      extraTurnPlayerId: snapshot.extraTurnPlayerId ?? null,
      currentTurnIndex: snapshot.currentTurnIndex || 0,
      witchTargetOwner: snapshot.witchTargetOwner || null,
    };
    unstable_batchedUpdates(() => {
      setPlayers(normalizedPlayers);
      setPlayerHands(snapshot.playerHands || {});
      setDeck(snapshot.deck || []);
      setReserveCards(snapshot.reserveCards || []);
      setCenterCards(snapshot.centerCards || []);
      setCenterMeta(normalizedCenterMeta);
      setWatchLog(snapshot.watchLog || []);
      setWatchNote(snapshot.watchNote || null);
      setCurrentTurnIndex(snapshot.currentTurnIndex || 0);
      setTurnTick(tick => tick + 1);
      setMoonPhase(snapshot.moonPhase || 0);
      setExtraTurnPlayerId(snapshot.extraTurnPlayerId ?? null);
      setWitchTargetOwner(snapshot.witchTargetOwner || null);
      setPlayedCardArena(snapshot.playedCardArena || null);
      setRecentArenaCards(Array.isArray(snapshot.recentArenaCards) ? snapshot.recentArenaCards.slice(0, 6) : []);
      setArenaFanOpen(false);
      // 不清除 arenaFocus：遠端快照頻繁套用時會讓「點面前牌放大」瞬間關掉
      setSeerSeen(null);
      setDrunkSeen(null);
      setSelectedHandCard(null);
      // 僅在回合已不屬於本機真人時才關閉互動彈窗，避免 Guest 出刺客等牌中途被遠端套用清掉彈窗而卡死
      {
        const incomingActor = normalizedPlayers[snapshot.currentTurnIndex];
        const stillMyHumanTurn = !!(incomingActor && !incomingActor.isAI && firebaseUser && incomingActor.uid === firebaseUser.uid);
        if (!stillMyHumanTurn) {
          setInteractionModal(null);
          setIsReturningCenterCard(false);
          pendingArenaCardRef.current = null;
        }
      }
      setBroadcastActionRaw(snapshot.broadcastAction || '');
      setBroadcastResult(snapshot.broadcastResult || '');
      setBroadcastReveal(snapshot.broadcastReveal || '');
      setBroadcastEvent(snapshot.broadcastEvent || null);
      setBroadcastPrivate(snapshot.broadcastPrivate || null);
      setHistoryLogs(snapshot.historyLogs || []);
      setGameOver(!!snapshot.gameOver);
      setWinnerInfo((() => {
        const w = snapshot.winnerInfo || null;
        if (!w) return null;
        if (w.scores && !Array.isArray(w.scores.rows)) {
          return { ...w, scores: { ...w.scores, rows: [] } };
        }
        return w;
      })());
      setWins(snapshot.wins || {});
      if (!snapshot.gameOver) setVictoryDismissed(false); // 「返回牌桌查看」只屬於本機，不同步
      // 不在此強制 victoryReady：留給 gameOver effect 等終局動畫（狼月等）播完
      setActionLocked(false);
      setGameReady(true);
    });
    // 下一幀再允許發布，避免用「套用前的本機舊狀態」覆寫剛寫入的遠端快照
    setTimeout(() => { applyingRemoteGameRef.current = false; }, 0);
  }, [roomData && roomData.gameState, screen, onlineSession, firebaseUser, forceApplyTick]);

  // Guest 救援：RTDB 已有牌局但本機一直 gameReady=false（例如錯過套用）→ 強制重跑套用
  useEffect(() => {
    if (!onlineSession || screen !== 'game' || !firebaseUser || !roomData) return;
    if (gameReady) return;
    const gs = roomData.gameState;
    if (!gs || !(gs.revision > 0)) return;
    // 降低 revision 門檻並觸發 apply effect 重跑
    gameRevisionRef.current = Math.max(0, (gs.revision || 1) - 1);
    if (gs.sourceUid === firebaseUser.uid) {
      setGameReady(true);
    } else {
      setForceApplyTick(t => t + 1);
    }
  }, [onlineSession, screen, gameReady, roomData && roomData.gameState, firebaseUser]);

  useEffect(() => {
    // 正在套用遠端快照：不要發布，也不可把 flag 清掉（否則會立刻用舊本機狀態覆寫）
    if (!onlineSession || screen !== 'game' || !gameReady || !firebaseUser || !roomCode) return;
    if (applyingRemoteGameRef.current) return;
    // 房主已清空 gameState 準備新局：僅非房主不可把上局手牌寫回去；房主必須能寫入 initGame 後的新狀態
    const hostOwnsRoom = roomData && roomData.hostUid === firebaseUser.uid;
    if (roomData && roomData.gameState == null && !hostOwnsRoom) return;
    const actor = players[currentTurnIndex];
    const actorUid = actor?.uid || null;
    const seqNow = turnSeqRef.current;
    // 單一權威：AI／月亮／煉金術士等連鎖只由房主寫入。
    // Guest 可發布的時機：
    //   (a) 當前行動者是自己（真人回合中）
    //   (b) 剛結束自己的回合（lastActorUid 仍是自己）——必須把「出牌結果 + proceedToNext 後的 currentTurnIndex」寫出去，
    //       否則房主永遠停在 Guest 回合，下一位 AI／玩家不會動。
    // 發布成功後 lastActorUid 會改成當前 actor（AI 為 null），Guest 即失去再寫入權，不會獨跑 AI。
    // 房主：恆可寫入。先前在「AI 回合結束換到其他真人」時 mayPublish 會變 false
    // （actor 是別人、justActed 因 AI 無 uid 被清成 null），導致換人快照發不出去、主客兩端都卡住。
    const isSelfHumanTurn = !!actor && !actor.isAI && actorUid === firebaseUser.uid;
    const justActed = lastActorUidRef.current === firebaseUser.uid;
    const mayPublish = hostOwnsRoom
      ? true
      : (isSelfHumanTurn || justActed);
    if (!mayPublish) return;
    if (gameSyncTimerRef.current) clearTimeout(gameSyncTimerRef.current);
    gameSyncTimerRef.current = setTimeout(async () => {
      // 上一個 transaction 還沒回來：先標記，待它完成後用最新狀態再發（否則會用舊 revision 被中止、最後一份換人快照遺失）
      if (publishInFlightRef.current && Date.now() - publishStartRef.current < 10000) {
        publishDirtyRef.current = true;
        return;
      }
      const myGen = publishGenRef.current;
      publishInFlightRef.current = true;
      publishStartRef.current = Date.now();
      publishDirtyRef.current = false;
      let needRetry = false;
      const nextRevision = gameRevisionRef.current + 1;
      // wins 以 ref 為準，避免 setWins 後 state 尚未重渲染就發布舊勝場
      const winsNow = winsRef.current || {};
      const gameState = JSON.parse(JSON.stringify({
        revision: nextRevision,
        turnSeq: seqNow,
        round: (roomData && roomData.round) || 0,
        sourceUid: firebaseUser.uid,
        players,
        playerHands,
        deck,
        reserveCards,
        centerCards,
        centerMeta,
        watchLog,
        watchNote,
        currentTurnIndex,
        moonPhase,
        extraTurnPlayerId,
        witchTargetOwner,
        playedCardArena,
        recentArenaCards,
        broadcastAction,
        broadcastResult,
        broadcastReveal,
        broadcastEvent,
        broadcastPrivate,
        historyLogs,
        gameOver,
        winnerInfo,
        wins: winsNow,
      }));
      try {
        const ref = firebase.database().ref(`rooms/${roomCode}/gameState`);
        const result = await ref.transaction(current => {
          // 已開新局（gen 變了）➔ 放棄這筆舊發布，不可把上局 gameOver／手牌寫回去
          if (publishGenRef.current !== myGen) return;
          return (current ? current.revision || 0 : 0) === gameRevisionRef.current
            ? { ...gameState, fxEvent: current && current.fxEvent || null }
            : undefined;
        });
        if (publishGenRef.current !== myGen) {
          // 新局已開始，忽略舊 transaction 結果
        } else if (result.committed) {
          gameRevisionRef.current = nextRevision;
          gameRoundRef.current = (roomData && roomData.round) || 0;
          // AI 無 uid：記成房主自己，避免下一拍 justActed 失效、換人快照被擋
          lastActorUidRef.current = actorUid || (hostOwnsRoom ? firebaseUser.uid : null);
          publishRetryRef.current = 0;
        } else if (publishRetryRef.current < 8) {
          // revision 對不上而被中止：不可放棄（會令換人快照遺失、下一位收不到回合），稍後用最新狀態重發
          publishRetryRef.current += 1;
          needRetry = true;
        }
      } catch (error) {
        if (publishGenRef.current === myGen) {
          setLobbyError(`遊戲狀態同步失敗：${error.message}`);
          if (publishRetryRef.current < 8) { publishRetryRef.current += 1; needRetry = true; }
        }
      } finally {
        if (publishGenRef.current === myGen) {
          publishInFlightRef.current = false;
          if (publishDirtyRef.current || needRetry) {
            publishDirtyRef.current = false;
            setTimeout(() => setSyncTick(t => t + 1), needRetry ? 250 : 0);
          }
        } else {
          publishInFlightRef.current = false;
        }
      }
    }, 120);
    return () => clearTimeout(gameSyncTimerRef.current);
  }, [
    screen, onlineSession, gameReady, firebaseUser, roomCode, roomData && roomData.hostUid,
    roomData && roomData.gameState == null,
    players, playerHands, deck, reserveCards, centerCards, centerMeta, watchLog, watchNote,
    currentTurnIndex, moonPhase, extraTurnPlayerId, witchTargetOwner, playedCardArena,
    broadcastAction, broadcastResult, broadcastReveal, broadcastEvent, broadcastPrivate, historyLogs, gameOver,
    winnerInfo, wins, syncTick,
  ]);

  // 全部角色牌參考清單
  const ALL_CARDS = useMemo(() => [...BASE_CARDS_DEF, WEREWOLF_CARD], []);

  // 各卡牌剩餘統計
  const remainingCounts = useMemo(() => {
    const counts = {};
    ALL_CARDS.forEach(c => counts[c.title] = { current: c.totalCount, total: c.totalCount });
    
    let activeCards = [...deck, ...reserveCards, ...centerCards];
    Object.values(playerHands).forEach(h => { if(Array.isArray(h)) activeCards.push(...h); });

    ALL_CARDS.forEach(c => {
      const inGameCount = activeCards.filter(card => card && card.title === c.title).length;
      counts[c.title].current = inGameCount;
    });

    return counts;
  }, [deck, reserveCards, centerCards, playerHands, ALL_CARDS]);

  const getNextAliveIndex = (fromIndex, pList = players) => {
    let nextIdx = (fromIndex + 1) % pList.length;
    let attempts = 0;
    while (pList[nextIdx].status === '出局' && attempts < pList.length) {
      nextIdx = (nextIdx + 1) % pList.length;
      attempts++;
    }
    return nextIdx;
  };

  const setHandNow = (id, hand) => {
    stateRef.current.playerHands = { ...stateRef.current.playerHands, [id]: hand };
    setPlayerHands(prev => ({ ...prev, [id]: hand }));
  };

  const eliminatePlayer = (targetId, killerId = null, reason = '牌效出局', keepHand = false) => {
    const st = stateRef.current;
    const target = st.players.find(p => p.id === targetId);
    if (!target || target.status === '出局') return;
    const targetHand = (st.playerHands[targetId] || []).filter(Boolean);

    // 面前有煉金術士：任何牌效出局（含自己打出市長／狼人）皆可棄掉並抽牌復活
    const hasAlchemist = playedCardsOf(target).some(c => c && c.title === '煉金術士');
    if (hasAlchemist) {
      // 從面前移除煉金術士；舊手牌公開置於面前（非 keepHand 時）；狀態維持存活
      const nextPlayed = [
        ...playedCardsOf(target).filter(c => c && c.title !== '煉金術士'),
        ...(keepHand ? [] : targetHand.filter(c => !playedCardsOf(target).some(x => x && x.id === c.id))),
      ];
      const nextPlayers = st.players.map(p =>
        p.id === targetId
          ? { ...p, status: '存活', protected: false, playedCards: nextPlayed }
          : p
      );
      stateRef.current.players = nextPlayers;
      setPlayers(nextPlayers);
      // 淘汰動畫已由牌效 log 啟動；此處再 queue 煉金術士棄牌復活動畫（排在淘汰之後）
      setBroadcastEvent({ type: 'revive', key: `${Date.now()}-${Math.random()}` });
      logActionAndResult(`${target.name} 遭遇淘汰`, `棄掉面前【煉金術士】抽牌復活！`, target.name, 'revive');
      const drawn = drawCardForPlayer(targetId, false) || takeReserveCard();
      setHandNow(targetId, drawn ? [drawn] : []);
      return;
    }

    const nextPlayers = st.players.map(p => p.id === targetId ? { ...p, status: '出局', protected: false, handTaken: !!keepHand, playedCards: keepHand ? playedCardsOf(p) : [...playedCardsOf(p), ...targetHand.filter(c => !playedCardsOf(p).some(x => x && x.id === c.id))] } : p);
    stateRef.current.players = nextPlayers;
    setPlayers(nextPlayers);
    if (!keepHand) setHandNow(targetId, []);
    // 不另開一筆紀錄：把「公開手牌」放在剛才那筆牌效結果的下一行（另一種顏色），並亮紅燈
    setBroadcastEvent({ type: 'out', key: `${Date.now()}-${Math.random()}` });
    if (keepHand) {
      // 手牌被間諜接手（不公開）：只亮紅燈，不列公開手牌
      setHistoryLogs(prev => prev.length ? [{ ...prev[0], event: 'out' }, ...prev.slice(1)] : prev);
    } else {
      // 淘汰動畫也要顯示該玩家公開展示的手牌（只附在與此人有關的那筆動畫上；比大小動畫本來就會翻開輸家的牌）
      const metaOf = (t) => [...BASE_CARDS_DEF, WEREWOLF_CARD].find(m => m.title === t);
      const revealEntry = { p: target, cards: targetHand.map(c => ({ title: c.title, value: c.value, icon: c.icon || (metaOf(c.title) || {}).icon })) };
      const attachReveal = (f) => (f && f.kind !== 'compare' && f.kind !== 'moon' && f.kind !== 'wolfbite' && f.kind !== 'score' && f.kind !== 'match' && f.kind !== 'place' && f.kind !== 'servant' && f.kind !== 'takeone'
        && ((f.tgt && f.tgt.id === targetId) || (f.src && f.src.id === targetId))
        && !(f.reveals || []).some(r => r.p.id === targetId))
        ? { ...f, reveals: [...(f.reveals || []), revealEntry] } : f;
      setFx(prev => attachReveal(prev));
      setHistoryLogs(prev => prev.length ? [{ ...prev[0], fx: attachReveal(prev[0].fx) }, ...prev.slice(1)] : prev);
      const handText = targetHand.length ? targetHand.map(c => `(${c.value})【${c.title}】`).join('、') : '無';
      const revealText = `${target.name} 公開手牌：${handText}`;
      setBroadcastReveal(prev => prev && prev.includes(revealText) ? prev : (prev ? `${prev}｜${revealText}` : revealText));
      setHistoryLogs(prev => prev.length ? [{ ...prev[0], reveal: prev[0].reveal && prev[0].reveal.includes(revealText) ? prev[0].reveal : (prev[0].reveal ? `${prev[0].reveal}｜${revealText}` : revealText), event: 'out' }, ...prev.slice(1)] : prev);
    }

    if (killerId !== null && killerId !== targetId && targetHand.some(c => c.title === '陰謀家')) {
      const killer = st.players.find(p => p.id === killerId);
      if (killer) {
        logActionAndResult(`${target.name} 手握【陰謀家】`, `觸發同歸於盡！${killer.name} 也同時出局`, target.name);
        eliminatePlayer(killerId, null, '陰謀家同歸於盡');
      }
    }

    setTimeout(() => { checkWinConditions(); }, 500);
  };

  const checkWinConditions = (isDeckEmpty = false) => {
    if (gameOverRef.current) return true;
    const st = stateRef.current;
    const alivePlayers = st.players.filter(p => p.status === '存活');
    if (alivePlayers.length === 1) {
      triggerVictory(alivePlayers[0], '存活勝利：成為場上唯一倖存的玩家！');
      return true;
    }
    if (alivePlayers.length === 0) {
      triggerVictory(null, '同歸於盡：無人獲勝！');
      return true;
    }
    if ((isDeckEmpty || st.deck.length === 0) && reserveDrawRef.current === null) {
      // 牌庫已空：若尚有人持 2 張手牌（尚未打出），等其打完再結算
      const anyoneHasTwo = alivePlayers.some(p => ((st.playerHands[p.id] || []).filter(Boolean).length >= 2));
      if (anyoneHasTwo) return false;
      resolveDeckEmptyVictory(alivePlayers);
      return true;
    }
    return false;
  };

  const resolveDeckEmptyVictory = (alivePlayers) => {
    if (gameOverRef.current) return;
    const hands = stateRef.current.playerHands;
    const fmtCard = (c) => c ? `(${c.value})【${c.title}】` : '';
    for (let p of alivePlayers) {
      const hand = hands[p.id] || [];
      if (hand.some(c => c && c.title === '乞丐之王')) {
        const has8or9 = alivePlayers.some(other => (hands[other.id] || []).some(c => c && (c.value === 8 || c.value === 9)));
        if (has8or9) {
          const handRows = alivePlayers.map(q => {
            const c = (hands[q.id] || [])[0];
            return { id: q.id, name: q.name, text: `${q.name} 手牌${c ? fmtCard(c) : '無'}`, sortVal: c ? c.value : -1 };
          }).sort((a, b) => b.sortVal - a.sortVal);
          const fxRowsB = alivePlayers.map(q => { const c = (hands[q.id] || [])[0] || null; return { p: q, card: c, base: c ? c.value : 0, mods: [], final: c ? c.value : 0 }; });
          const scoreFxB = buildScoreFx(fxRowsB, 'beggar', [p.id], `乞丐之王發動！${p.name} 獨享勝利`);
          startFx(scoreFxB);
          triggerVictory(p, '乞丐之王勝利：發動絕密乞丐之王，獨享勝利！', true, { title: '乞丐之王結算：存活玩家手牌', rows: handRows, fx: scoreFxB });
          return;
        }
      }
    }

    let maxScore = -99;
    let winners = [];
    const rows = [];
    const fxRows = [];
    alivePlayers.forEach(p => {
      const hand = hands[p.id] || [];
      const card = hand[0];
      let finalVal = card ? card.value : 0;
      let detail = card ? `手牌${fmtCard(card)}` : '無手牌';
      let fxMods = [];
      if (playedCardsOf(p).some(c => c && c.title === '商人')) { finalVal += 2; detail += '＋商人 +2'; fxMods = [{ label: '商人 +2' }]; }
      if (card && card.title === '科學怪人' && playedCardsOf(p).length > 0) {
        const vals = playedCardsOf(p).filter(Boolean).map(c => c.value);
        if (vals.length > 0) {
          const mn = Math.min(...vals), mx = Math.max(...vals);
          finalVal = mn + mx;
          detail = `手牌${fmtCard(card)}面前最小(${mn})＋最大(${mx})`;
          fxMods = [{ label: `最小${mn}＋最大${mx}` }];
        }
      }
      fxRows.push({ p, card: card || null, base: card ? card.value : 0, mods: fxMods, final: finalVal });
      rows.push({ id: p.id, name: p.name, text: `${p.name} ${detail} ＝ (${finalVal})`, final: finalVal });
      if (finalVal > maxScore) { maxScore = finalVal; winners = [p]; }
      else if (finalVal === maxScore) winners.push(p);
    });
    rows.sort((a, b) => b.final - a.final);
    const winTextS = winners.length === 1 ? `${winners[0].name} 獲勝（${maxScore} 分）` : `${winners.map(w => w.name).join(' & ')} 平手，共同獲勝（${maxScore} 分）`;
    const scoreFx = buildScoreFx(fxRows, 'score', winners.map(w => w.id), winTextS);
    startFx(scoreFx);
    const scores = { title: '最終點數結算（牌庫耗盡）', rows, fx: scoreFx };

    if (winners.length === 1) triggerVictory(winners[0], `數值勝利：手牌結算最高分 (${maxScore}分)！`, false, scores);
    else triggerVictory(winners, `數值平手：共同分享勝利 (${maxScore}分)！`, false, scores);
  };

  const triggerVictory = (winner, reason, noWitch = false, scores = null) => {
    if (gameOverRef.current) return;
    gameOverRef.current = true;
    victoryLocalRef.current = true;
    const st = stateRef.current;
    const list = Array.isArray(winner) ? [...winner] : (winner ? [winner] : []);
    let winnerText = list.map(w => w.name).join(' & ') || '無人';
    const winnerIds = list.map(x => x.id);
    const w = st.witchTargetOwner;
    if (!noWitch && w && list.some(x => x.id === w.targetId) && !list.some(x => x.id === w.witchOwnerId)) {
      const witchOwner = st.players.find(p => p.id === w.witchOwnerId);
      if (witchOwner) { winnerText += ` & ${witchOwner.name} (女巫共同獲勝)`; winnerIds.push(witchOwner.id); }
    }
    setGameOver(true);
    lastRoundWinnerIdsRef.current = [...new Set(winnerIds)];
    // 勝場：每位獲勝者（含共同獲勝）得 1 個月亮標記
    // 3–4 人場累計 3 勝整場；5–6 人場累計 2 勝整場
    const playerCount = (st.players || []).length;
    const winsNeeded = playerCount <= 4 ? 3 : 2;
    const nextWins = { ...winsRef.current };
    [...new Set(winnerIds)].forEach(id => { nextWins[id] = (nextWins[id] || 0) + 1; });
    winsRef.current = nextWins;
    setWins(nextWins);
    const matchWinnerIds = [...new Set(winnerIds)].filter(id => nextWins[id] >= winsNeeded);
    const matchWinners = matchWinnerIds.map(id => (st.players.find(p => p.id === id) || {}).name).filter(Boolean);
    const scoreRows = scores && scores.rows ? scores.rows.map(r => ({ ...r, win: winnerIds.includes(r.id) })) : null;
    let matchFxKey = null;
    let matchFxObj = null;
    if (matchWinnerIds.length > 0) {
      clearWinsNextRef.current = true;
      matchFxObj = {
        key: `${Date.now()}-${Math.random()}`,
        kind: 'match',
        card: null, src: null, tgt: null, tone: 'ok',
        winsNeeded,
        matchWinners: matchWinnerIds.map(id => {
          const p = st.players.find(x => x.id === id);
          return { id, name: (p && p.name) || '?', p: p || null };
        }),
        baseDur: (typeof FX_DURATION !== 'undefined' && FX_DURATION.match) || 7200,
        duration: (typeof FX_TOTAL_BY !== 'undefined' && FX_TOTAL_BY.match) || 7200,
      };
      matchFxKey = matchFxObj.key;
      // 若前面已 startFx 最終比點，此處會排入佇列，等比點播完／點掉後再播集滿標記
      startFx(matchFxObj);
    }
    const scoreFxKey = (scores && scores.fx && scores.fx.key) || null;
    setWinnerInfo({
      winnerName: winnerText, reason, matchWinners, winnerIds: [...new Set(winnerIds)], winsNeeded,
      matchFxKey,
      // 勝利視窗等「最後一段」終局動畫：有整場勝出動畫則等 match，否則等比點／狼月等
      scores: scoreRows
        ? { title: scores.title, rows: scoreRows, fxKey: matchFxKey || scoreFxKey, scoreFxKey }
        : (matchFxKey ? { title: '', rows: [], fxKey: matchFxKey } : null),
    });
    setBroadcastAction(`遊戲結束！【${winnerText}】獲勝`);
    setBroadcastResult(`➔ ${reason}`);
    setHistoryLogs(prev => [{ id: `${Date.now()}-${Math.random()}`, player: '系統', action: `遊戲結束！【${winnerText}】獲勝`, result: reason, reveal: '', event: null, card: `遊戲結束！【${winnerText}】獲勝 ➔ ${reason}` }, ...prev]);
    if (scoreRows && scoreRows.length) {
      setHistoryLogs(prev => [{ id: `${Date.now()}-${Math.random()}`, player: '系統', action: scores.title, result: scoreRows.map(r => `${r.win ? '🏆 ' : ''}${r.text}`).join('\n'), reveal: '', event: null, card: scores.title, fx: scores.fx || null }, ...prev]);
    }
    // 集滿標記整場勝利動畫也寫入行動紀錄，方便回放
    if (matchFxObj) {
      const names = (matchWinners && matchWinners.length) ? matchWinners.join(' & ') : winnerText;
      setHistoryLogs(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        player: '系統',
        action: '月亮標記集滿・整場勝利',
        result: `【${names}】累計 ${winsNeeded} 個月亮標記，贏得整場！`,
        reveal: '',
        event: null,
        card: `月亮標記集滿・整場勝利 ➔ 【${names}】`,
        fx: matchFxObj,
      }, ...prev]);
    }
  };

  const moonArenaCard = (moon, name, phase) => ({ ...moon, value: '🌙', category: `月亮 ${phase}/3`, icon: 'fa-moon', playedBy: name, isMoon: true });

  // 第 3 張月亮翻開：手握狼人者獲勝（叛徒連帶）。回傳是否已結束遊戲
  const checkWerewolfMoonWin = () => {
    const st = stateRef.current;
    let werewolfWinner = null;
    let traitorWinner = null;
    st.players.filter(p => p.status === '存活').forEach(p => {
      const hand = (st.playerHands[p.id] || []).filter(Boolean);
      if (hand.some(c => c.title === '狼人')) werewolfWinner = p;
      if (hand.some(c => c.title === '叛徒')) traitorWinner = p;
    });
    if (!werewolfWinner) return false;
    const winners = [werewolfWinner];
    let reasonText = '狼月降臨勝利：第3張月亮翻開，手握狼人者掌控夜晚！';
    if (traitorWinner && traitorWinner.id !== werewolfWinner.id) {
      winners.push(traitorWinner);
      reasonText += `叛徒【${traitorWinner.name}】共同獲勝！`;
    }
    triggerVictory(winners, reasonText);
    return true;
  };

  // 第 3 張月亮翻開後，玩家（或 AI）用「拿一還一」放回牌、或守夜人保留牌之後，手上握著狼人 ➔ 立即獲勝（叛徒連帶）並播咬鏡頭動畫。
  // handCards＝此刻該玩家的手牌（直接傳入，避免讀到尚未更新的狀態）。回傳是否已結束遊戲
  const wolfWinAfterSwap = (pid, handCards) => {
    const st = stateRef.current;
    if (gameOverRef.current || st.moonPhase < 3) return false;
    const holder = st.players.find(p => p.id === pid);
    if (!holder || holder.status !== '存活') return false;
    if (!(handCards || []).some(c => c && c.type === 'WEREWOLF')) return false;
    let traitorWinner = null;
    st.players.filter(p => p.status === '存活' && p.id !== pid).forEach(p => {
      if ((st.playerHands[p.id] || []).some(c => c && c.title === '叛徒')) traitorWinner = p;
    });
    logActionAndResult(`${holder.name} 手握【狼人】`, '第 3 張月亮已翻開 ➔ 狼月降臨', holder.name);
    const winners = [holder];
    let reasonText = '狼月降臨勝利：第3張月亮已翻開，手握狼人者掌控夜晚！';
    if (traitorWinner) { winners.push(traitorWinner); reasonText += `叛徒【${traitorWinner.name}】共同獲勝！`; }
    triggerVictory(winners, reasonText);
    return true;
  };

  const pushArenaCard = (card) => {
    if (!card) return;
    const entry = { ...card, arenaAt: Date.now() };
    setPlayedCardArena(entry);
    setRecentArenaCards(prev => [entry, ...(prev || []).filter(c => c && c.id !== entry.id)].slice(0, 6));
    setArenaFocus(null);
  };
  // 把延後的出牌展示推到 C 區（確認發動後才呼叫）
  const commitPendingArena = () => {
    const pending = pendingArenaCardRef.current;
    if (!pending) return;
    pendingArenaCardRef.current = null;
    pushArenaCard(pending);
  };

  // 回合抽牌：只抽 1 張。若是月亮牌 ➔ 先「打出」展示並計數，由玩家再選擇抽一打一／拿一還一（不給額外回合）
  const drawTurnCard = (playerId) => {
    const st = stateRef.current;
    const drawer = st.players.find(p => p.id === playerId);
    const tempDeck = [...st.deck];
    if (tempDeck.length === 0) return { card: null };
    const drawn = tempDeck.pop();
    stateRef.current.deck = tempDeck;
    setDeck(tempDeck);
    if (!drawn.isMoon) return { card: drawn };
    const phase = st.moonPhase + 1;
    stateRef.current.moonPhase = phase;
    setMoonPhase(phase);
    pushArenaCard(moonArenaCard(drawn, drawer.name, phase));
    logActionAndResult(`${drawer.name} 翻開【${drawn.title}】`, `月亮 ${phase}/3 ➔ 繼續抽牌`, drawer.name);
    if (phase >= 3 && checkWerewolfMoonWin()) return { card: null, moon: drawn, gameEnded: true };
    // 牌庫最後一張是月亮牌：不立刻結算，翻開者本回合的「抽一打一」改從備用牌抽，該回合結束後才結算
    if (tempDeck.length === 0) reserveDrawRef.current = playerId;
    return { card: null, moon: drawn };
  };

  // 從備用牌隨機抽 1 張（抽出後從備用牌堆移除）；同時結束「欠一次備用牌」的狀態
  const drawReserveCard = () => {
    const st = stateRef.current;
    reserveDrawRef.current = null;
    const avail = st.reserveCards.map((c, i) => c ? i : -1).filter(i => i >= 0);
    if (avail.length === 0) return null;
    const idx = avail[Math.floor(Math.random() * avail.length)];
    const card = st.reserveCards[idx];
    const next = st.reserveCards.filter((_, i) => i !== idx);
    stateRef.current.reserveCards = next;
    setReserveCards(next);
    return card;
  };

  // 取一張備用牌補位（牌庫抽空時用）：會真的從備用牌移除，避免同一張牌出現兩份；不動 reserveDrawRef
  const takeReserveCard = () => {
    const st = stateRef.current;
    const idx = (st.reserveCards || []).findIndex(Boolean);
    if (idx < 0) return null;
    const card = st.reserveCards[idx];
    const next = st.reserveCards.filter((_, i) => i !== idx);
    stateRef.current.reserveCards = next;
    setReserveCards(next);
    return card;
  };

  const drawCardForPlayer = (playerId, grantExtra = true) => {
    const st = stateRef.current;
    const drawer = st.players.find(p => p.id === playerId);
    let tempDeck = [...st.deck];
    let phase = st.moonPhase;
    let finalDrawnCard = null;

    while (tempDeck.length > 0) {
      const drawn = tempDeck.pop();
      if (drawn.isMoon) {
        phase += 1;
        setMoonPhase(phase);
        stateRef.current.moonPhase = phase;
        pushArenaCard(moonArenaCard(drawn, drawer.name, phase));
        logActionAndResult(`${drawer.name} 翻開【${drawn.title}】`, `月亮牌 ${phase}/3`, drawer.name);

        if (phase >= 3) {
          let werewolfWinner = null;
          let traitorWinner = null;
          st.players.filter(p => p.status === '存活').forEach(p => {
            const hand = (st.playerHands[p.id] || []).filter(Boolean);
            if (hand.some(c => c.title === '狼人')) werewolfWinner = p;
            if (hand.some(c => c.title === '叛徒')) traitorWinner = p;
          });
          if (werewolfWinner) {
            const winners = [werewolfWinner];
            let reasonText = '狼月降臨勝利：第3張月亮翻開，手握狼人者掌控夜晚！';
            if (traitorWinner && traitorWinner.id !== werewolfWinner.id) {
              winners.push(traitorWinner);
              reasonText += `叛徒【${traitorWinner.name}】共同獲勝！`;
            }
            stateRef.current.deck = tempDeck;
            setDeck(tempDeck);
            triggerVictory(winners, reasonText);
            return null;
          }
        }
      } else {
        finalDrawnCard = drawn;
        break;
      }
    }
    stateRef.current.deck = tempDeck;
    setDeck(tempDeck);
    if (finalDrawnCard && playerId === humanPlayerId) {
      playDrawAnim(finalDrawnCard, 'deck', 1);
      // 牌效造成的抽牌（女巫復活、賞金獵人重抽、煉金術士復活）：僅記錄自己抽到的牌
      const playerName = players.find(p => p.id === playerId)?.name || '你';
      const privateResult = `${playerName} 抽到(${finalDrawnCard.value})【${finalDrawnCard.title}】`;
      setHistoryLogs(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        player: playerName,
        action: `${playerName} 抽牌`,
        result: '抽牌完成',
        privateView: { playerIds: [playerId], action: `${playerName} 抽牌`, result: privateResult, reveal: '' },
      }, ...prev]);
    }
    return finalDrawnCard;
  };

  // 賞金獵人：目標先公開原手牌放在面前，再重抽 1 張。
  // 公開的牌若是市長／狼人 ➔ 目標立刻出局（不再重抽）；若是吸血鬼且面前已有 2 張 7 以上 ➔ 目標獲勝。
  // 先寫「賞金獵人」那筆紀錄，再抽牌，這樣重抽時翻出的月亮牌與遊戲結束會排在後面。
  const resolveBounty = (actionText, logName, sourceId, targetId) => {
    const st = stateRef.current;
    const target = st.players.find(p => p.id === targetId);
    if (!target) { advanceTurn(); return; }
    const oldHand = ((st.playerHands[targetId] || []).filter(Boolean))[0] || null;
    const revealText = oldHand ? `${target.name} 公開手牌：(${oldHand.value})【${oldHand.title}】` : '';
    const markRevealed = () => {
      if (oldHand) setPlayers(prev => prev.map(p => p.id === targetId ? { ...p, playedCards: [...playedCardsOf(p).filter(c => !(c && c.id === oldHand.id)), { ...oldHand, revealedBy: 'BOUNTY' }] } : p));
    };

    if (oldHand && (oldHand.type === 'MAYOR' || oldHand.type === 'WEREWOLF')) {
      logActionAndResult(actionText, `強制公開手牌，面前放了${oldHand.title} ➔ ${target.name} 出局！`, logName, null, revealText);
      eliminatePlayer(targetId, sourceId, '賞金獵人公開市長/狼人出局');
      setPlayers(prev => prev.map(p => p.id === targetId ? { ...p, playedCards: playedCardsOf(p).map(c => c && c.id === oldHand.id ? { ...c, revealedBy: 'BOUNTY' } : c) } : p));
      advanceTurn();
      return;
    }
    if (oldHand && oldHand.type === 'VAMPIRE' && playedCardsOf(target).filter(c => c && c.value >= 7).length >= 2) {
      markRevealed();
      logActionAndResult(actionText, '強制公開手牌，面前高階牌足夠', logName, null, revealText);
      logActionAndResult(`${target.name} 吸血鬼降臨`, `面前集滿 ${playedCardsOf(target).filter(c => c && c.value >= 7).length} 張 7 以上的牌 ➔ 立刻獲勝`, target.name);
      triggerVictory(target, '賞金獵人觸發吸血鬼降臨勝利！');
      return;
    }

    // 預看重抽結果（不改狀態），只為了把「你 取得…」寫進這筆紀錄
    let preview;
    { let phase = st.moonPhase; const dk = st.deck; preview = undefined;
      for (let i = dk.length - 1; i >= 0; i--) {
        const c = dk[i];
        if (c.isMoon) {
          phase += 1;
          if (phase >= 3 && st.players.some(p => p.status === '存活' && (st.playerHands[p.id] || []).some(h => h && h.title === '狼人'))) { preview = null; break; }
        } else { preview = c; break; }
      } }
    const previewCard = preview === undefined ? st.reserveCards[0] : preview;
    markRevealed();
    const drewSecretCard = targetId === humanPlayerId && previewCard;
    logActionAndResult(
      actionText,
      `強制重抽${drewSecretCard ? gotCardsText([previewCard]) : ''}`,
      logName,
      null,
      revealText,
      drewSecretCard
        ? { privateTo: [targetId], publicResult: '強制重抽 1 張手牌', publicReveal: revealText }
        : null
    );

    const drawn = drawCardForPlayer(targetId, false);
    if (gameOverRef.current) return;
    const gotCard = drawn || takeReserveCard();
    setHandNow(targetId, gotCard ? [gotCard] : []);
    advanceTurn();
  };

  const handleActionA = () => {
    if (lockRef.current) return;
    if (fx && (fx.kind === 'moon' || fx.kind === 'wolfbite' || fx.kind === 'vampire')) return;
    if (gameOver || !isMyTurn) return;
    const currentHand = playerHands[humanPlayerId] || [];
    const owesReserve = reserveDrawRef.current === humanPlayerId && deck.length === 0;
    if (currentHand.length >= 2 || (deck.length === 0 && !owesReserve)) return;

    if (owesReserve) {
      // 牌庫最後一張月亮翻開後：抽一打一改從備用牌隨機抽 1 張
      const rc = drawReserveCard();
      if (rc) {
        setPlayerHands(prev => ({ ...prev, [humanPlayerId]: [...currentHand, rc] }));
        playDrawAnim(rc, 'deck', 2);
        logActionAndResult(
          '你 執行【抽一打一】',
          `牌庫已空，從備用牌抽到(${rc.value})【${rc.title}】`,
          '你',
          null,
          '',
          { privateTo: [humanPlayerId], publicResult: '從備用牌抽牌完成，請打出 1 張手牌' }
        );
      } else {
        advanceTurn();
      }
      return;
    }

    const result = drawTurnCard(humanPlayerId);
    if (result.card) {
      setPlayerHands(prev => ({ ...prev, [humanPlayerId]: [...currentHand, result.card] }));
      playDrawAnim(result.card, 'deck', 2);
      logActionAndResult(
        '你 執行【抽一打一】',
        `抽到(${result.card.value})【${result.card.title}】`,
        '你',
        null,
        '',
        { privateTo: [humanPlayerId], publicResult: '抽牌完成，請打出 1 張手牌' }
      );
    } else if (result.moon) {
      // 月亮牌已打出：仍只有 1 張手牌，可再選「抽一打一」或「拿一還一」
      if (!gameOverRef.current) setBroadcastResult(`➔ 月亮 ${stateRef.current.moonPhase}/3，請繼續【抽一打一】${reserveDrawRef.current === humanPlayerId ? '（牌庫已空，將從備用牌抽）' : ''}或【拿一還一】`);
    } else if (!gameOverRef.current) {
      advanceTurn();
    }
  };

  const closeCenterModal = () => {
    setIsCenterCardsModalOpen(false);
    setCenterPickMode(false);
    setPickSlot(null);
  };

  // 拿一還一：先開啟暗牌視窗，由玩家自選要拿哪一格
  const handleActionB = () => {
    if (lockRef.current) return;
    if (fx && (fx.kind === 'moon' || fx.kind === 'wolfbite' || fx.kind === 'vampire')) return;
    if (gameOver || !isMyTurn) return;
    const currentHand = playerHands[humanPlayerId] || [];
    if (currentHand.length >= 2 || centerCards.filter(Boolean).length === 0) return;
    setPickSlot(null);
    setCenterPickMode(true);
    setIsCenterCardsModalOpen(true);
  };

  const confirmTakeCenter = (slot) => {
    if (lockRef.current || gameOver || !isMyTurn) return;
    const currentHand = playerHands[humanPlayerId] || [];
    const taken = centerCards[slot];
    if (currentHand.length >= 2 || !taken) return;

    const newCenter = [...centerCards];
    newCenter[slot] = null; // 該格暫時空出，放回的牌會回到同一格
    setCenterCards(newCenter);
    setPlayerHands(prev => ({ ...prev, [humanPlayerId]: [...currentHand, taken] }));
    playDrawAnim(taken, 'center', 2);
    setIsReturningCenterCard(true);
    setSelectedHandCard(null);
    takenCardRef.current = taken;
    takenSlotRef.current = slot;

    // 玩家看過這格暗牌
    setCenterMeta(prev => prev.map((m, i) => i === slot ? {
      ...m,
      viewedBy: m.viewedBy.includes(humanPlayerId) ? m.viewedBy : [...m.viewedBy, humanPlayerId],
      knownBy: {
        ...Object.fromEntries(Object.entries(centerKnowledge(m)).map(([ownerId, knowledge]) => [ownerId, { ...knowledge, stale: true }])),
        [humanPlayerId]: { card: taken, stale: false },
      },
      myCard: taken,
      myCardOwnerId: humanPlayerId,
      myStale: false,
    } : m));
    setCenterKnownSet(prev => prev ? prev.filter(c => c.id !== taken.id) : prev);
    closeCenterModal();

    setBroadcastAction('你 執行【拿一還一】');
    setBroadcastResult('➔ 已選取暗牌，請拖曳 1 張手牌放回同一格');
    setPrivateBroadcast(humanPlayerId, '你 執行【拿一還一】', `從暗牌 ${slot + 1} 拿到(${taken.value})【${taken.title}】，請拖曳 1 張手牌放回同一格`);
  };

  const handleCardClick = (card) => {
    if (gameOver || !isMyTurn) return;
    const myHand = playerHands[humanPlayerId] || [];
    if (myHand.length < 2) return;

    setSelectedHandCard(selectedHandCard?.id === card.id ? null : card);
  };

  // ---- 拖曳出牌：把手牌向上拖到中央戰場（C 區）後放開即出牌；放在戰場外放開則取消
  const canDragPlay = () => (
    !gameOver && isMyTurn && !actionLocked && !lockRef.current && !interactionModal &&
    (playerHands[humanPlayerId] || []).filter(Boolean).length >= 2
  );
  const isOverArena = (x, y) => {
    const el = arenaRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
  };
  const clearLongPress = () => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  };
  const handleHandPointerDown = (e, card) => {
    if (drawAnim) clearDrawAnim();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { cardId: card.id, startX: e.clientX, startY: e.clientY, moved: false, zoomed: false, pointerId: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    // 長按約 0.45 秒（期間沒有拖動）➔ 顯示放大的手牌，放開即關閉
    clearLongPress();
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null;
      const d = dragRef.current;
      if (d && !d.moved) { d.zoomed = true; setZoomCard(card); }
    }, 450);
  };
  const handleHandPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.zoomed) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 10) return;
      clearLongPress();
      if (!canDragPlay()) return;
      d.moved = true;
    }
    const card = (playerHands[humanPlayerId] || []).find(c => c && c.id === d.cardId);
    if (!card) return;
    setDragGhost({ card, x: e.clientX, y: e.clientY, over: isOverArena(e.clientX, e.clientY) });
  };
  const handleHandPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    clearLongPress();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    if (d && d.zoomed) { setZoomCard(null); lastTapRef.current = null; return; }
    if (d && !d.moved) {
      // 雙點同一張手牌 ➔ 直接出牌
      const now = Date.now();
      const lt = lastTapRef.current;
      const card = (playerHands[humanPlayerId] || []).find(c => c && c.id === d.cardId);
      if (lt && lt.cardId === d.cardId && now - lt.time < 380) {
        lastTapRef.current = null;
        if (card && canDragPlay()) handleConfirmPlay(card);
      } else {
        lastTapRef.current = { cardId: d.cardId, time: now };
      }
      return;
    }
    if (!d || !d.moved) return;
    const card = (playerHands[humanPlayerId] || []).find(c => c && c.id === d.cardId);
    const over = isOverArena(e.clientX, e.clientY);
    setDragGhost(null);
    if (card && over && canDragPlay()) handleConfirmPlay(card);
  };
  const handleHandPointerCancel = () => {
    dragRef.current = null;
    clearLongPress();
    setZoomCard(null);
    setDragGhost(null);
  };

  const handleConfirmPlay = (cardArg) => {
    const chosen = (cardArg && cardArg.id) ? cardArg : selectedHandCard;
    if (!chosen || !isMyTurn) return;
    if (lockRef.current) return;
    lockRef.current = true;
    setActionLocked(true);
    
    if (isReturningCenterCard) {
      const cardToReturn = chosen;
      const remainingHand = (playerHands[humanPlayerId] || []).filter(c => c.id !== cardToReturn.id);
      const slotRef = takenSlotRef.current;
      const idx = (slotRef !== null && slotRef !== undefined) ? slotRef : Math.max(0, centerCards.findIndex(c => !c));

      setPlayerHands(prev => ({ ...prev, [humanPlayerId]: remainingHand }));
      setCenterCards(prev => { const n = [...prev]; n[idx] = cardToReturn; return n; });
      metaApplySwap(idx, humanPlayerId, cardToReturn);
      setSelectedHandCard(null);
      setIsReturningCenterCard(false);

      const taken = takenCardRef.current;
      logActionAndResult(
        '你 執行【拿一還一】',
        `${taken ? `從暗牌 ${idx + 1} 拿到(${taken.value})【${taken.title}】，` : ''}放回(${cardToReturn.value})【${cardToReturn.title}】 ➔ 中央暗牌維持 3 張`,
        '你',
        null,
        '',
        {
          privateTo: [humanPlayerId],
          privateFx: true,
          publicAction: '你 執行【拿一還一】',
          publicResult: `暗牌 ${idx + 1} 被拿起並放回 ➔ 中央暗牌維持 3 張，回合結束`,
        }
      );
      takenCardRef.current = null;
      takenSlotRef.current = null;
      if (wolfWinAfterSwap(humanPlayerId, remainingHand)) return; // 放回之後手上握著狼人（第 3 張月亮後）➔ 立刻獲勝
      advanceTurn();
      return;
    }

    const cardToPlay = chosen;
    setSelectedHandCard(null);
    executePlayPhase(humanPlayerId, cardToPlay);
  };

  const executePlayPhase = (playerId, card) => {
    const player = stateRef.current.players.find(p => p.id === playerId);
    // 同步更新 stateRef，避免 AI 掘墓人等連續出牌讀到舊手牌
    const nextHand = (stateRef.current.playerHands[playerId] || []).filter(c => c && c.id !== card?.id);
    stateRef.current.playerHands = { ...stateRef.current.playerHands, [playerId]: nextHand };
    setPlayerHands(prev => ({ ...prev, [playerId]: nextHand }));
    if (!player) return;
    const nextPlayers = stateRef.current.players.map(p => p.id === playerId ? { ...p, protected: card?.type === 'BODYGUARD', playedCards: [...playedCardsOf(p), card] } : p);
    stateRef.current.players = nextPlayers;
    setPlayers(nextPlayers);
    // 人類需選目標／確認的牌：暫不推 C 區，等確認發動後再出現並播動畫
    const deferArena = playerId === humanPlayerId && card && HUMAN_PENDING_ARENA_TYPES.has(card.type);
    if (deferArena) {
      pendingArenaCardRef.current = { ...card, playedBy: player.name };
    } else {
      pendingArenaCardRef.current = null;
      pushArenaCard({ ...card, playedBy: player.name });
    }
    // 延後結算，確保讀到已更新的手牌與面前牌
    setTimeout(() => { if (!gameOverRef.current && resolveRef.current) resolveRef.current(playerId, card); }, 500 * slow());
  };

  // 醉漢：所有存活且未受保護的玩家（含自己）手牌收集洗勻後各發 1 張
  // 每位參與者各自看到自己的換出／換入（動畫、動態、紀錄）；公開只顯示重發摘要
  const doDrunkDeal = (sourceId) => {
    const stNow = stateRef.current;
    const source = stNow.players.find(p => p.id === sourceId);
    if (!source) { advanceTurn(); return; }
    const participants = stNow.players.filter(p => p.status === '存活' && (p.id === sourceId || !p.protected));
    const skipped = stNow.players.filter(p => p.status === '存活' && p.id !== sourceId && p.protected);
    const oldHands = stNow.playerHands;
    let pool = [];
    participants.forEach(p => { pool.push(...(oldHands[p.id] || []).filter(Boolean)); });
    pool = shuffle(pool);
    const dealt = {};
    participants.forEach(p => { dealt[p.id] = pool.length ? [pool.pop()] : []; });
    stateRef.current.playerHands = { ...oldHands, ...dealt };
    setPlayerHands(prev => ({ ...prev, ...dealt }));
    const publicResult = skipped.length
      ? `全員手牌已重發（${skipped.map(p => p.name).join('、')} 受保護未參與）`
      : '全員手牌已重發';
    const drunkMeta = {
      parties: participants.map(p => ({
        id: p.id,
        name: p.name,
        out: cardSnap(((oldHands[p.id] || []).filter(Boolean))[0]),
        in: cardSnap(((dealt[p.id] || []).filter(Boolean))[0]),
      })),
      skipped: skipped.map(p => p.name),
    };
    const privateTo = participants.map(p => p.id);
    // 結果字串用公開摘要；各玩家的換出／換入由 drunkMeta 在本機個人化（動畫、動態、紀錄）
    logActionAndResult(
      `${source.name} 打出了(1)【醉漢】重洗手牌`,
      publicResult,
      source.name,
      null,
      '',
      { privateTo, privateFx: true, publicResult, drunkMeta }
    );
    advanceTurn();
  };

  const resolveCardEffect = (sourceId, card) => {
    const source = (stateRef.current.players || []).find(p => p.id === sourceId) || players.find(p => p.id === sourceId);
    if (!card || !card.type) { advanceTurn(); return; }
    if (!source) { advanceTurn(); return; }

    switch (card.type) {
      case 'MAYOR':
      case 'WEREWOLF':
        logActionAndResult(`${source.name} 打出了(${card.value})【${card.title}】`, '自我淘汰！', source.name);
        eliminatePlayer(sourceId, sourceId, `打出【${card.title}】自我淘汰`);
        advanceTurn();
        break;

      case 'VAMPIRE': {
        const highCards = playedCardsOf(source).filter(c => c && c.value >= 7);
        if (highCards.length >= 2) {
          logActionAndResult(`${source.name} 打出了(${card.value})【吸血鬼】吸血鬼降臨`, `面前集滿 ${highCards.length} 張 7 以上的牌 ➔ 立刻獲勝`, source.name);
          triggerVictory(source, '吸血鬼降臨：面前集滿兩張 7 以上卡牌，立刻勝利！');
        } else {
          logActionAndResult(`${source.name} 打出了(${card.value})【吸血鬼】`, '沒有任何效果（面前高階牌不足）', source.name);
          advanceTurn();
        }
        break;
      }

      case 'BODYGUARD':
        logActionAndResult(`${source.name} 打出了(4)【保鏢】獲得保護`, '免役牌效直至下個回合', source.name);
        advanceAfterPassive();
        break;

      case 'SERVANT':
        logActionAndResult(`${source.name} 打出了(1)【僕人】`, '置於面前 ➔ 可立即棄掉換額外回合', source.name);
        // 打出後可立刻使用：人類開選擇；AI 高機率立即使用
        if (sourceId === humanPlayerId) {
          lockRef.current = false;
          setActionLocked(false);
          setInteractionModal({ type: 'SERVANT_CHOICE', title: '僕人', servantId: card.id });
        } else {
          const delay = 500;
          whenFxDone(() => {
            if (gameOverRef.current) return;
            if (Math.random() < 0.7) useServant(sourceId, card.id);
            else advanceTurn();
          }, delay);
        }
        break;

      case 'PASSIVE': {
        const passiveWhy = PASSIVE_WHY[card.title] || '';
        logActionAndResult(
          `${source.name} 打出了(${card.value})【${card.title}】`,
          passiveWhy ? `沒有任何效果（${passiveWhy}）` : '無任何效果',
          source.name
        );
        // 被動牌：畫面可 sticky 等人點；AI 流程只等動畫時長後換人
        advanceAfterPassive();
        break;
      }

      case 'DRUNKARD': {
        // 玩家自己打出醉漢：先秘密檢視所有參與者的手牌，按下「洗牌重發」才洗牌發牌
        if (sourceId === humanPlayerId) {
          const stV = stateRef.current;
          const partsV = stV.players.filter(p => p.status === '存活' && (p.id === humanPlayerId || !p.protected));
          const skippedV = stV.players.filter(p => p.status === '存活' && p.id !== humanPlayerId && p.protected);
          const viewV = partsV.map(p => ({ p, card: ((stV.playerHands[p.id] || []).filter(Boolean))[0] || null }));
          // 出牌者左下角要看到所有參與者（含自己）當下的手牌
          setDrunkSeen(viewV.filter(v => v.card).map(v => ({ targetId: v.p.id, card: v.card })));
          setInteractionModal({ type: 'DRUNK_VIEW', title: '醉漢：秘密檢視所有手牌', view: viewV, skipped: skippedV });
          break;
        }
        doDrunkDeal(sourceId);
        break;
      }

      case 'VILLAGER':
      case 'ASSASSIN':
      case 'SEER':
      case 'TAX_COLLECTOR':
      case 'INQUISITOR':
      case 'BARKEEPER':
      case 'GIRL':
      case 'THIEF':
      case 'PICKPOCKET':
      case 'SWAP_HAND':
      case 'WITCH':
      case 'BOUNTY_HUNTER':
      case 'GRAVEDIGGER':
      case 'NIGHT_WATCHMAN': {
        if (sourceId === humanPlayerId) {
          const stH = stateRef.current;
          const plist = stH.players || [];
          const aliveOpp = plist.filter(p => p.id !== sourceId && p.status === '存活' && !p.protected);
          const deadAll = plist.filter(p => p.status === '出局');
          const gravePool = plist.filter(p => (p.id === sourceId || !p.protected) && playedCardsOf(p).some(canSteal));
          const needsTarget = !['NIGHT_WATCHMAN'].includes(card.type);
          let validTargets = aliveOpp;
          if (card.type === 'WITCH') validTargets = deadAll;
          else if (card.type === 'BOUNTY_HUNTER') validTargets = [plist.find(p => p.id === sourceId), ...aliveOpp].filter(Boolean);
          else if (card.type === 'GRAVEDIGGER') validTargets = gravePool;
          else if (card.type === 'PICKPOCKET' || card.type === 'SWAP_HAND') {
            // 扒手需至少 2 個可參與者（可含自己）
            validTargets = [plist.find(p => p.id === sourceId), ...aliveOpp].filter(Boolean);
          }

          if (needsTarget && card.type === 'PICKPOCKET') {
            if (validTargets.length < 2) {
              // 無可選目標：先確認是否仍要打出（取消可收回手牌）
              setInteractionModal({
                type: 'CONFIRM_NO_TARGET',
                card,
                title: `打出【${card.title}】`,
                message: '目前沒有可選擇的目標。確定打出？將結算為「沒有任何效果」。',
              });
              break;
            }
          } else if (needsTarget && validTargets.length === 0) {
            setInteractionModal({
              type: 'CONFIRM_NO_TARGET',
              card,
              title: `打出【${card.title}】`,
              message: '目前沒有可選擇的目標。確定打出？將結算為「沒有任何效果」。',
            });
            break;
          }

          // 只剩 1 個可選目標：仍開確認彈窗，但跳過頭像選擇（預填唯一目標）
          if (needsTarget && validTargets.length === 1 && card.type !== 'PICKPOCKET' && card.type !== 'NIGHT_WATCHMAN') {
            setInteractionModal({ type: card.type, card, preselectTargetId: validTargets[0].id });
            break;
          }
          setInteractionModal({ type: card.type, card });
        } else {
          handleAIEffectSelection(sourceId, card);
        }
        break;
      }

      default: {
        const passiveWhy = PASSIVE_WHY[card.title] || '';
        logActionAndResult(`${source.name} 打出了(${card.value})【${card.title}】`, passiveWhy ? `沒有任何效果（${passiveWhy}）` : '無任何效果', source.name);
        advanceAfterPassive();
        break;
      }
    }
  };

  const handleAIEffectSelection = (sourceId, card) => {
    const stNow = stateRef.current;
    const aliveTargets = (stNow.players || []).filter(p => p.id !== sourceId && p.status === '存活' && !p.protected);
    const sourcePlayer = (stNow.players || []).find(p => p.id === sourceId) || players.find(p => p.id === sourceId);
    if (!sourcePlayer) {
      advanceTurn();
      return;
    }

    if (card.type === 'NIGHT_WATCHMAN') {
      const center = [...centerCards];
      const aiHand = playerHands[sourceId] || [];
      const combined = [...center, ...aiHand];
      // 第 3 張月亮翻開後，若看到狼人就留下它（留在手上即獲勝）；否則維持原本：留下自己的手牌
      const wolfPick = stateRef.current.moonPhase >= 3 ? combined.find(c => c && c.type === 'WEREWOLF') : null;
      const keepCard = wolfPick || combined[combined.length - 1];
      const restCards = combined.filter(c => c !== keepCard);
      setCenterCards(shuffle(restCards));
      metaWatchman(sourceId, null, '');
      setPlayerHands(prev => ({ ...prev, [sourceId]: [keepCard] }));
      logActionAndResult(`${sourcePlayer.name} 打出了(${card.value})【守夜人】`, '檢視中央暗牌 ➔ 重新洗牌歸位', sourcePlayer.name);
      if (wolfWinAfterSwap(sourceId, [keepCard])) return;
      advanceTurn();
      return;
    }

    if (card.type === 'GRAVEDIGGER') {
      const stG = stateRef.current;
      const validTargets = (stG.players || []).filter(p => (p.id === sourceId || !p.protected) && playedCardsOf(p).some(canSteal));
      if (validTargets.length > 0) {
        const target = validTargets[Math.floor(Math.random() * validTargets.length)];
        const stealable = playedCardsOf(target).filter(canSteal);
        const { revealedBy: _rb, ...stolenCard } = stealable[Math.floor(Math.random() * stealable.length)];

        const nextPlayers = stG.players.map(p => p.id === target.id ? { ...p, playedCards: playedCardsOf(p).filter(c => c && c.id !== stolenCard.id) } : p);
        stateRef.current.players = nextPlayers;
        setPlayers(nextPlayers);
        // 用 stateRef 當下手牌（已不含掘墓人），再加入奪取的牌
        const handNow = (stateRef.current.playerHands[sourceId] || []).filter(Boolean);
        const newHand = [...handNow, stolenCard];
        setHandNow(sourceId, newHand);

        logActionAndResult(
          `${sourcePlayer.name} 對 ${target.name} 打出了(${card.value})【掘墓人】`,
          `奪取面前(${stolenCard.value})【${stolenCard.title}】`,
          sourcePlayer.name
        );

        // 後半段：等掘墓人動畫後再打第二張；安全網避免 whenFxDone 異常卡死
        let secondDone = false;
        const playSecond = () => {
          if (secondDone || gameOverRef.current) return;
          const st = stateRef.current;
          if ((st.players[st.currentTurnIndex] || {}).id !== sourceId) return;
          secondDone = true;
          const h = (st.playerHands[sourceId] || []).filter(Boolean);
          const pick = aiPickCard(h);
          if (pick) executePlayPhase(sourceId, pick);
          else advanceTurn();
        };
        whenFxDone(playSecond, 800);
        setTimeout(playSecond, Math.max(8000 * slow(), 3000 * slow() + 4000));
      } else {
        logActionAndResult(`${sourcePlayer.name} 打出了(${card.value})【掘墓人】`, '沒有任何效果（沒有可選擇目標）', sourcePlayer.name);
        advanceTurn();
      }
      return;
    }

    if (card.type === 'PICKPOCKET') {
      // 扒手可指定自己：候選＝所有存活且未受保護的對手＋出牌者自己
      const pickPool = [sourcePlayer, ...aliveTargets];
      if (pickPool.length < 2) {
        logActionAndResult(`${sourcePlayer.name} 打出了(${card.value})【扒手】`, '沒有任何效果（沒有可選擇目標）', sourcePlayer.name);
      } else {
        const [a, b] = shuffle(pickPool);
        const handsNow = stNow.playerHands || playerHands;
        const aH = handsNow[a.id] || [];
        const bH = handsNow[b.id] || [];
        setPlayerHands(prev => ({ ...prev, [a.id]: bH, [b.id]: aH }));
        const pickViewers = [...new Set([sourceId, a.id, b.id])];
        const swapMeta = buildSwapMeta(a, aH, b, bH);
        logActionAndResult(
          `${sourcePlayer.name} 打出了(${card.value})【扒手】`,
          formatSwapResultForViewer(`秘密交換了 ${a.name} 與 ${b.name} 的手牌`, swapMeta, humanPlayerId),
          sourcePlayer.name,
          null,
          '',
          { privateTo: pickViewers, privateFx: true, publicAction: `${sourcePlayer.name} 打出了(${card.value})【扒手】`, publicResult: `秘密交換了 ${a.name} 與 ${b.name} 的手牌`, swapMeta }
        );
      }
      advanceTurn();
      return;
    }

    if (aliveTargets.length === 0) {
      logActionAndResult(`${sourcePlayer.name} 打出了(${card.value})【${card.title}】`, '沒有任何效果（沒有可選擇目標）', sourcePlayer.name);
      advanceTurn();
      return;
    }
    const randomTarget = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];

    switch (card.type) {
      case 'BOUNTY_HUNTER': {
        resolveBounty(`${sourcePlayer.name} 對 ${randomTarget.name} 打出了(${card.value})【賞金獵人】`, sourcePlayer.name, sourceId, randomTarget.id);
        break;
      }
      case 'VILLAGER':
      case 'ASSASSIN': {
        const guessedVal = Math.floor(Math.random() * 11);
        executeGuess(sourceId, randomTarget.id, guessedVal, card.type === 'ASSASSIN');
        break;
      }
      case 'SEER':
        // 公開播秘密檢視動畫（不揭露牌面）
        logActionAndResult(
          `${sourcePlayer.name} 對 ${randomTarget.name} 打出了(${card.value})【先知】`,
          '秘密檢視完成',
          sourcePlayer.name
        );
        advanceTurn();
        break;
      case 'TAX_COLLECTOR': {
        const targetHand = playerHands[randomTarget.id] || [];
        const targetVal = targetHand[0] ? targetHand[0].value : '?';
        const isHit = targetHand.some(c => c?.value === 0 || c?.value === 1);
        logActionAndResult(
          `${sourcePlayer.name} 對 ${randomTarget.name} 打出了(2)【稅務官】審查`,
          isHit ? `${randomTarget.name}(${targetVal})出局！` : `審查失敗 ➔ ${randomTarget.name} 手牌非 0 或 1`,
          sourcePlayer.name
        );
        if (isHit) eliminatePlayer(randomTarget.id, sourceId, '稅務官審查出局');
        advanceTurn();
        break;
      }
      case 'INQUISITOR': {
        const targetHand = playerHands[randomTarget.id] || [];
        const targetVal = targetHand[0] ? targetHand[0].value : '?';
        const isHit = targetHand.some(c => c?.value === 9 || c?.value === 10);
        logActionAndResult(
          `${sourcePlayer.name} 對 ${randomTarget.name} 打出了(2)【審判官】審判`,
          isHit ? `${randomTarget.name}(${targetVal})出局！` : `審判失敗 ➔ ${randomTarget.name} 手牌非 9 或 10`,
          sourcePlayer.name
        );
        if (isHit) eliminatePlayer(randomTarget.id, sourceId, '審判官審判出局');
        advanceTurn();
        break;
      }
      case 'BARKEEPER':
      case 'GIRL': {
        const sHand = (playerHands[sourceId] || [])[0];
        const tHand = (playerHands[randomTarget.id] || [])[0];
        const cardVal = 3;
        const cardName = card.type === 'BARKEEPER' ? '酒保' : '小女孩';
        const cmpType = card.type === 'BARKEEPER' ? '比大' : '比小';
        const compareAction = `${sourcePlayer.name} 對 ${randomTarget.name} 打出了(${cardVal})【${cardName}】${cmpType}`;
        const reportComparison = (resultText) => logActionAndResult(
          compareAction,
          resultText,
          sourcePlayer.name
        );
        if (sHand && tHand) {
          if (card.type === 'BARKEEPER') {
            if (sHand.value < tHand.value) {
              reportComparison(`${sourcePlayer.name}手牌較小出局！`);
              eliminatePlayer(sourceId, randomTarget.id, '酒保比大出局');
            } else if (tHand.value < sHand.value) {
              reportComparison(`${randomTarget.name}手牌較小出局！`);
              eliminatePlayer(randomTarget.id, sourceId, '酒保比大出局');
            } else {
              reportComparison('雙方數值相同，平手無事發生');
            }
          } else {
            if (sHand.value > tHand.value) {
              reportComparison(`${sourcePlayer.name}手牌較大出局！`);
              eliminatePlayer(sourceId, randomTarget.id, '小女孩比小出局');
            } else if (tHand.value > sHand.value) {
              reportComparison(`${randomTarget.name}手牌較大出局！`);
              eliminatePlayer(randomTarget.id, sourceId, '小女孩比小出局');
            } else {
              reportComparison('雙方數值相同，平手無事發生');
            }
          }
        }
        advanceTurn();
        break;
      }
      case 'SWAP_HAND':
      case 'THIEF': {
        const handsNow = (stNow.playerHands || playerHands);
        const sHand = handsNow[sourceId] || [];
        const tHand = handsNow[randomTarget.id] || [];
        setPlayerHands(prev => ({ ...prev, [sourceId]: tHand, [randomTarget.id]: sHand }));
        const swapMeta = buildSwapMeta(sourcePlayer, sHand, randomTarget, tHand);
        const thiefViewers = [...new Set([sourceId, randomTarget.id])];
        logActionAndResult(
          `${sourcePlayer.name} 對 ${randomTarget.name} 打出了(${card.value})【${card.title}】`,
          formatSwapResultForViewer('手牌交換成功！獲得額外回合', swapMeta, humanPlayerId),
          sourcePlayer.name,
          null,
          '',
          {
            privateTo: thiefViewers,
            privateFx: true,
            publicAction: `${sourcePlayer.name} 對 ${randomTarget.name} 打出了(${card.value})【${card.title}】`,
            publicResult: '秘密交換手牌，獲得額外回合',
            swapMeta,
          }
        );
        setExtraTurnPlayerId(sourceId);
        advanceTurn();
        break;
      }
      case 'WITCH': {
        const deadPlayers = players.filter(p => p.status === '出局');
        if (deadPlayers.length > 0) {
          const reviveP = deadPlayers[Math.floor(Math.random() * deadPlayers.length)];
          const drawn = drawCardForPlayer(reviveP.id, false) || takeReserveCard();
          setPlayerHands(prev => ({ ...prev, [reviveP.id]: drawn ? [drawn] : [] }));
          setPlayers(prev => prev.map(p => p.id === reviveP.id ? { ...p, status: '存活', protected: false } : p));
          setWitchTargetOwner({ witchOwnerId: sourceId, targetId: reviveP.id });
          logActionAndResult(`${sourcePlayer.name} 打出了(${card.value})【女巫】`, `復活了 ${reviveP.name} ➔ 綁定共同勝利`, sourcePlayer.name, 'revive');
        } else {
          logActionAndResult(`${sourcePlayer.name} 打出了(${card.value})【女巫】`, '沒有任何效果（沒有可選擇目標）', sourcePlayer.name);
        }
        advanceTurn();
        break;
      }
      default:
        advanceTurn();
        break;
    }
  };

  const executeGuess = (sourceId, targetId, guessedValue, isAssassin = false, skipSpy = false, secondGuessIn = null) => {
    const targetHand = (playerHands[targetId] || []).filter(Boolean);
    const target = players.find(p => p.id === targetId);
    const source = players.find(p => p.id === sourceId);
    const cardName = isAssassin ? '刺客' : '村民';
    const cardValue = isAssassin ? 0 : 1;

    // 刺客：兩次猜測（同一人）。人類自選；AI 隨機選一個不同數值
    let secondGuess = null;
    if (isAssassin) {
      if (secondGuessIn !== null && !Number.isNaN(secondGuessIn)) secondGuess = secondGuessIn;
      else {
        const pool = [...Array(11).keys()].filter(v => v !== guessedValue);
        secondGuess = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    const guesses = isAssassin ? [guessedValue, secondGuess] : [guessedValue];
    const guessText = isAssassin ? `猜(${guessedValue})與(${secondGuess})` : `猜(${guessedValue})`;
    const actionText = `${source.name} 對 ${target.name} 打出了(${cardValue})【${cardName}】${guessText}`;
    const hitValue = guesses.find(g => targetHand.some(c => c.value === g));

    if (hitValue !== undefined) {
      logActionAndResult(actionText, `猜測成功！${target.name}(${hitValue}) 出局`, source.name);
      eliminatePlayer(targetId, sourceId, `遭猜中數值 ${hitValue}`);
      advanceTurn();
      return;
    }

    // 猜測未中：目標手握間諜可反殺
    const spyCardIndex = targetHand.findIndex(c => c.type === 'SPY');
    if (spyCardIndex !== -1 && !skipSpy) {
      if (targetId === humanPlayerId) {
        setInteractionModal({ type: 'COUNTER_SPY', title: '間諜反殺', sourceId, targetId, guessedValue, secondGuess, isAssassin });
        return;
      }
      // AI 間諜觸發反殺：使猜測者出局，並接手其手牌
      const sourceHand = (stateRef.current.playerHands[sourceId] || []).filter(Boolean);
      setPlayers(prev => prev.map(p => p.id === targetId ? { ...p, playedCards: [...playedCardsOf(p), targetHand[spyCardIndex]] } : p));
      logActionAndResult(actionText, `${target.name} 打出【間諜】反殺！${source.name} 出局且接手手牌`, target.name);
      eliminatePlayer(sourceId, null, '間諜反殺', true);
      setHandNow(sourceId, []);              // 被淘汰者的手牌已被接手，不再留在他手上
      setHandNow(targetId, sourceHand);
      advanceTurn();
      return;
    }

    logActionAndResult(actionText, '猜測失敗 ➔ 無事發生', source.name);
    advanceTurn();
  };

  const handleHumanInteractionSubmit = (payload) => {
    const { type, targetId, guessedValue, guessedValue2, secondaryTargetId, stolenCardId, keepCardId } = payload;
    const sourceId = humanPlayerId;
    const target = players.find(p => p.id === targetId);
    setInteractionModal(null);
    // 確認發動後才把牌推到 C 區並播動畫（SERVANT_CHOICE 出牌時已展示，pending 為空）
    if (type !== 'SERVANT_CHOICE' && type !== 'COUNTER_SPY' && type !== 'INFO') {
      commitPendingArena();
    }

    if (type === 'SERVANT_CHOICE') {
      useServant(humanPlayerId, payload.servantId);
    } else if (type === 'CONFIRM_NO_TARGET') {
      const c = payload.card;
      if (c) logActionAndResult(`你 打出了(${c.value})【${c.title}】`, '沒有任何效果（沒有可選擇目標）', '你');
      else logActionAndResult('你 打出了牌', '沒有任何效果（沒有可選擇目標）', '你');
      advanceTurn();
    } else if (type === 'DRUNK_VIEW') {
      doDrunkDeal(humanPlayerId);
    } else if (type === 'VILLAGER' || type === 'ASSASSIN') {
      executeGuess(humanPlayerId, targetId, parseInt(guessedValue), type === 'ASSASSIN', false, type === 'ASSASSIN' ? parseInt(guessedValue2) : null);
    } else if (type === 'NIGHT_WATCHMAN') {
      const myHand = playerHands[humanPlayerId] || [];
      const combined = [...centerCards, ...myHand];
      const keptCard = combined.find(c => c.id === keepCardId) || combined[0];
      const remainingCenter = combined.filter(c => c.id !== keptCard.id);
      const shuffledCenter = shuffle(remainingCenter);
      setCenterCards(shuffledCenter);
      const oldHandCard = myHand[0];
      const watchNoteText = (oldHandCard && keptCard.id !== oldHandCard.id)
        ? `你換出 (${keptCard.value})【${keptCard.title}】、換入 (${oldHandCard.value})【${oldHandCard.title}】`
        : '你沒有換出中央牌（留下原本的手牌）';
      metaWatchman(humanPlayerId, shuffledCenter, watchNoteText);
      setPlayerHands(prev => ({ ...prev, [humanPlayerId]: [keptCard] }));
      logActionAndResult(
        '你 打出了(3)【守夜人】',
        '檢視並調整中央暗牌 ➔ 成功保留 1 張卡牌',
        '你',
        null,
        '',
        { privateTo: [humanPlayerId], privateFx: true, publicAction: '你 打出了(3)【守夜人】', publicResult: '調整中央暗牌完成' }
      );
      if (wolfWinAfterSwap(humanPlayerId, [keptCard])) return; // 保留的是狼人（第 3 張月亮後）➔ 立刻獲勝
      advanceTurn();
    } else if (type === 'GRAVEDIGGER') {
      const targetP = players.find(p => p.id === targetId);
      const stolenRaw = playedCardsOf(targetP).find(c => c.id === stolenCardId);
      if (stolenRaw && canSteal(stolenRaw)) {
        const { revealedBy: _rb, ...stolen } = stolenRaw;
        setPlayers(prev => prev.map(p => p.id === targetId ? { ...p, playedCards: playedCardsOf(p).filter(c => c.id !== stolenCardId) } : p));
        setHandNow(humanPlayerId, [...(playerHands[humanPlayerId] || []).filter(Boolean), stolen]);
        logActionAndResult(
          `你 對 ${targetP.name} 打出了(6)【掘墓人】`,
          `奪取了面前(${stolen.value})【${stolen.title}】｜請選擇一張手牌打出`,
          '你'
        );
        // 後半段：解除鎖定，讓玩家從 2 張手牌中拖曳 1 張到戰場打出並結算（不結束回合）
        lockRef.current = false;
        setActionLocked(false);
        setSelectedHandCard(null);
        setBroadcastResult('➔ 請拖曳 1 張手牌到戰場打出');
      } else {
        logActionAndResult('你 打出了(6)【掘墓人】', '沒有任何效果（沒有可選擇目標）', '你');
        advanceTurn();
      }
    } else if (type === 'BOUNTY_HUNTER') {
      resolveBounty(`你 對 ${targetId === humanPlayerId ? '自己' : target.name} 打出了(5)【賞金獵人】`, '你', humanPlayerId, targetId);
    } else if (type === 'SEER') {
      const targetHand = playerHands[targetId] || [];
      const cName = targetHand[0] ? targetHand[0].title : '無';
      const cVal = targetHand[0] ? targetHand[0].value : '?';
      // 公開播「秘密檢視」動畫（不揭露牌面）；牌面結果僅先知私密可見
      logActionAndResult(
        `你 對 ${target.name} 打出了(2)【先知】`,
        `秘密檢視結果 ➔ ${target.name} 手牌為 ${cName}(${cVal})`,
        '你',
        null,
        '',
        {
          privateTo: [humanPlayerId],
          privateFx: true,
          publicAction: `你 對 ${target.name} 打出了(2)【先知】`,
          publicResult: '秘密檢視完成',
        }
      );
      setSeerSeen(targetHand[0] ? { targetId, card: targetHand[0] } : null);
      advanceTurn();
    } else if (type === 'TAX_COLLECTOR') {
      const targetHand = playerHands[targetId] || [];
      const targetVal = targetHand[0] ? targetHand[0].value : '?';
      const isHit = targetHand.some(c => c.value === 0 || c.value === 1);
      logActionAndResult(
        `你 對 ${target.name} 打出了(2)【稅務官】審查`,
        isHit ? `${target.name}(${targetVal})手牌符合 ➔ 宣佈出局！` : `審查失敗 ➔ ${target.name} 手牌非 0 或 1`,
        '你'
      );
      if (isHit) eliminatePlayer(targetId, humanPlayerId, '稅務官審查出局');
      advanceTurn();
    } else if (type === 'INQUISITOR') {
      const targetHand = playerHands[targetId] || [];
      const targetVal = targetHand[0] ? targetHand[0].value : '?';
      const isHit = targetHand.some(c => c.value === 9 || c.value === 10);
      logActionAndResult(
        `你 對 ${target.name} 打出了(2)【審判官】審判`,
        isHit ? `${target.name}(${targetVal})手牌符合 ➔ 宣佈出局！` : `審判失敗 ➔ ${target.name} 手牌非 9 或 10`,
        '你'
      );
      if (isHit) eliminatePlayer(targetId, humanPlayerId, '審判官審判出局');
      advanceTurn();
    } else if (type === 'BARKEEPER' || type === 'GIRL') {
      const sHand = (playerHands[humanPlayerId] || [])[0];
      const tHand = (playerHands[targetId] || [])[0];
      const cName = type === 'BARKEEPER' ? '酒保' : '小女孩';
      const compareAction = `你 對 ${target.name} 打出了(3)【${cName}】${type === 'BARKEEPER' ? '比大' : '比小'}`;
      const reportComparison = (resultText) => logActionAndResult(
        compareAction,
        resultText,
        '你'
      );
      if (sHand && tHand) {
        if (type === 'BARKEEPER') {
          if (sHand.value < tHand.value) {
            reportComparison('你手牌較小出局！');
            eliminatePlayer(humanPlayerId, targetId, '酒保比大出局');
          } else if (tHand.value < sHand.value) {
            reportComparison(`${target.name}手牌較小出局！`);
            eliminatePlayer(targetId, humanPlayerId, '酒保比大出局');
          } else {
            reportComparison('雙方數值相同，平手無事發生');
          }
        } else {
          if (sHand.value > tHand.value) {
            reportComparison('你手牌較大出局！');
            eliminatePlayer(humanPlayerId, targetId, '小女孩比小出局');
          } else if (tHand.value > sHand.value) {
            reportComparison(`${target.name}手牌較大出局！`);
            eliminatePlayer(targetId, humanPlayerId, '小女孩比小出局');
          } else {
            reportComparison('雙方數值相同，平手無事發生');
          }
        }
      }
      advanceTurn();
    } else if (type === 'THIEF' || type === 'SWAP_HAND') {
      const sHand = playerHands[humanPlayerId] || [];
      const tHand = playerHands[targetId] || [];
      setPlayerHands(prev => ({ ...prev, [humanPlayerId]: tHand, [targetId]: sHand }));
      const selfP = players.find(p => p.id === humanPlayerId) || { id: humanPlayerId, name: '你' };
      const swapMeta = buildSwapMeta(selfP, sHand, target, tHand);
      const thiefViewers = [...new Set([humanPlayerId, targetId])];
      logActionAndResult(
        `你 對 ${target.name} 打出了(7)【小偷】`,
        formatSwapResultForViewer('手牌交換成功！獲得額外回合', swapMeta, humanPlayerId),
        '你',
        null,
        '',
        {
          privateTo: thiefViewers,
          privateFx: true,
          publicAction: `你 對 ${target.name} 打出了(7)【小偷】`,
          publicResult: '秘密交換手牌，獲得額外回合',
          swapMeta,
        }
      );
      setExtraTurnPlayerId(humanPlayerId);
      advanceTurn();
    } else if (type === 'PICKPOCKET') {
      const t1 = players.find(p => p.id === targetId);
      const t2 = players.find(p => p.id === secondaryTargetId);
      const t1Hand = playerHands[targetId] || [];
      const t2Hand = playerHands[secondaryTargetId] || [];
      setPlayerHands(prev => ({ ...prev, [targetId]: t2Hand, [secondaryTargetId]: t1Hand }));
      const pickViewers = [...new Set([humanPlayerId, targetId, secondaryTargetId])];
      const swapMeta = buildSwapMeta(t1, t1Hand, t2, t2Hand);
      logActionAndResult(
        `你 打出了(6)【扒手】`,
        formatSwapResultForViewer(`秘密交換了 ${t1.name} 與 ${t2.name} 的手牌`, swapMeta, humanPlayerId),
        '你',
        null,
        '',
        { privateTo: pickViewers, privateFx: true, publicAction: '你 打出了(6)【扒手】', publicResult: `秘密交換了 ${t1.name} 與 ${t2.name} 的手牌`, swapMeta }
      );
      advanceTurn();
    } else if (type === 'WITCH') {
      const deadTargets = players.filter(p => p.status === '出局');
      if (deadTargets.length > 0 && targetId !== undefined && target) {
        const drawn = drawCardForPlayer(targetId, false) || takeReserveCard();
        setPlayerHands(prev => ({ ...prev, [targetId]: drawn ? [drawn] : [] }));
        setPlayers(prev => prev.map(p => p.id === targetId ? { ...p, status: '存活', protected: false } : p));
        setWitchTargetOwner({ witchOwnerId: humanPlayerId, targetId });
        logActionAndResult(`你 打出了(4)【女巫】`, `復活了 ${target.name} ➔ 綁定共同勝利`, '你', 'revive');
      } else {
        logActionAndResult('你 打出了(4)【女巫】', '沒有任何效果（沒有可選擇目標）', '你');
      }
      advanceTurn();
    } else if (type === 'COUNTER_SPY') {
      const attacker = players.find(p => p.id === payload.attackerId);
      const attackerHand = playerHands[payload.attackerId] || [];
      logActionAndResult(
        '你 打出了(7)【間諜】',
        `反殺猜測者 ${attacker.name}！該玩家淘汰並奪取其手牌${gotCardsText(attackerHand, [])}`,
        '你',
        null,
        '',
        { privateTo: [humanPlayerId], publicResult: `反殺猜測者 ${attacker.name}！該玩家出局，手牌已被接手` }
      );
      eliminatePlayer(payload.attackerId, humanPlayerId, '間諜反殺出局', true);
      const spyC = (playerHands[humanPlayerId] || []).find(c => c && c.type === 'SPY');
      if (spyC) setPlayers(prev => prev.map(p => p.id === humanPlayerId ? { ...p, playedCards: [...playedCardsOf(p), spyC] } : p));
      setHandNow(payload.attackerId, []);    // 被淘汰者的手牌已被接手，不再留在他手上
      setHandNow(humanPlayerId, attackerHand.filter(Boolean));
      // advanceTurn 內部會處理鎖定與換人，確保在 eliminatePlayer 之後執行
      advanceTurn();
    }
  };

  const proceedToNext = (forceExtra = null) => {
    lockRef.current = false;
    setActionLocked(false);
    const st = stateRef.current;
    const extra = forceExtra !== null ? forceExtra : st.extraTurnPlayerId;
    let nextIdx;
    // extraTurnPlayerId 存的是玩家 id；currentTurnIndex 是座位索引
    if (extra !== null) {
      const extraIdx = st.players.findIndex(p => p && p.id === extra);
      if (extraIdx >= 0 && st.players[extraIdx].status === '存活') nextIdx = extraIdx;
      else nextIdx = getNextAliveIndex(st.currentTurnIndex, st.players);
    } else {
      nextIdx = getNextAliveIndex(st.currentTurnIndex, st.players);
    }
    setExtraTurnPlayerId(null);
    turnSeqRef.current += 1;
    // 保鏢：下個回合開始時解除保護（比對玩家 id，不是座位索引）
    const nextPlayerId = (st.players[nextIdx] || {}).id;
    const nextPlayers = st.players.map(p => p.id === nextPlayerId ? { ...p, protected: false } : p);
    stateRef.current = { ...st, players: nextPlayers, currentTurnIndex: nextIdx, extraTurnPlayerId: null };
    setPlayers(nextPlayers);
    setCurrentTurnIndex(nextIdx);
    setTurnTick(t => t + 1);
    setAiKick(k => k + 1);
  };
  // 換人時一律解鎖，避免出牌後 actionLocked 卡住無法抽牌
  useEffect(() => {
    lockRef.current = false;
    setActionLocked(false);
  }, [currentTurnIndex]);

  const useServant = (pid, servantId) => {
    const p = stateRef.current.players.find(x => x.id === pid);
    setPlayers(prev => prev.map(x => x.id === pid ? { ...x, playedCards: playedCardsOf(x).filter(c => !(c && c.id === servantId)) } : x));
    // 動畫播放期間先鎖住操作，播完才開始額外回合
    lockRef.current = true;
    setActionLocked(true);
    logActionAndResult(`${p.name} 棄掉面前【僕人】`, '立刻進行額外回合！', p.name);
    whenFxDone(() => {
      if (gameOverRef.current) return;
      proceedToNext(pid);
    }, 250);
  };

  const advanceTurn = () => {
    const st0 = stateRef.current;
    const active = st0.players[st0.currentTurnIndex];
    if (onlineSession && active && (
      active.isAI
        ? !roomData || roomData.hostUid !== (firebaseUser && firebaseUser.uid)
        : active.uid !== (firebaseUser && firebaseUser.uid)
    )) return;

    lockRef.current = true;
    setActionLocked(true);
    // AI 出牌後多留時間給玩家看動畫；人類出牌後較短
    // 注意：只等動畫 duration（whenFxDone），不等人點 sticky；點擊只影響本機畫面
    const baseDelay = 500; // 留一個短緩衝讓狀態先 commit，之後換人
    whenFxDone(() => {
      lockRef.current = false;
      setActionLocked(false);
      if (gameOverRef.current) return;
      reserveDrawRef.current = null;
      if (checkWinConditions()) return;
      const st = stateRef.current;
      const cur = st.players[st.currentTurnIndex];
      if (cur && cur.status === '存活' && st.extraTurnPlayerId === null) {
        const servant = playedCardsOf(cur).find(c => c && c.type === 'SERVANT');
        if (servant) {
          if (cur.isAI) { useServant(cur.id, servant.id); return; }
          setInteractionModal({ type: 'SERVANT_CHOICE', title: '僕人', servantId: servant.id });
          return;
        }
      }
      proceedToNext();
    }, baseDelay);
  };

  // 被動／置於面前類（含煉金術士、商人、叛徒等）：動畫可 sticky 等人點，但換人必須依時長推進（不依賴點擊）
  // 換人前保持鎖定，避免出牌後還能再按「抽一打一」；另加安全網避免 whenFxDone 異常卡死
  const advanceAfterPassive = () => {
    const st0 = stateRef.current;
    const active = st0.players[st0.currentTurnIndex];
    const isAi = !!(active && active.isAI);
    if (onlineSession && active && (
      isAi
        ? !roomData || roomData.hostUid !== (firebaseUser && firebaseUser.uid)
        : active.uid !== (firebaseUser && firebaseUser.uid)
    )) return;

    lockRef.current = true;
    setActionLocked(true);
    // AI 被動牌：等動畫時長後立刻換人（略短於一般 AI 延遲，避免像卡死）
    const delay = 500;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      lockRef.current = false;
      setActionLocked(false);
      if (gameOverRef.current) return;
      reserveDrawRef.current = null;
      if (checkWinConditions()) return;
      proceedToNext(); // 內部會再解鎖
    };
    whenFxDone(finish, delay);
    // 安全網：被動牌（煉金術士等）最多再等約 8 秒必換人，避免卡死
    setTimeout(finish, Math.max(delay + 2500, 8000 * slow()));
  };

  useEffect(() => {
    if (gameOver) return;

    // 牌庫耗盡不在此處結算：須等當前玩家打出手牌、回合結束後由 advanceTurn → checkWinConditions 處理

    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer) return;

    if (currentPlayer.status === '出局') {
      advanceTurn();
      return;
    }

    if (currentPlayer.isAI) {
      if (onlineSession && (!roomData || roomData.hostUid !== (firebaseUser && firebaseUser.uid))) return;
      if (pausedRef.current) { pendingAiRef.current = true; return; }
      // AI 行動只等動畫 duration，不等人點 sticky；點擊只清畫面
      const cancelAiWait = whenFxDone(async () => {
        if (pausedRef.current) { pendingAiRef.current = true; return; }
        pendingAiRef.current = false;
        const myToken = ++aiRunRef.current;
        const mySeq = turnSeqRef.current;
        const stale = () => gameOverRef.current || aiRunRef.current !== myToken || stateRef.current.currentTurnIndex !== currentTurnIndex || turnSeqRef.current !== mySeq;
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const pid = currentPlayer.id;
        if (stale()) return;

        let hand = (stateRef.current.playerHands[pid] || []).filter(Boolean);
        let drawnCard = null;
        while (hand.length < 2 && stateRef.current.deck.length > 0) {
          if (stale()) return;
          if (hand.length === 1 && stateRef.current.centerCards.some(Boolean) && Math.random() < 0.25) {
            aiCenterSwap(pid);
            return;
          }
          const result = drawTurnCard(pid);
          if (result.gameEnded || gameOverRef.current) return;
          if (result.card) { drawnCard = result.card; break; }
          if (result.moon) {
            await new Promise(r => whenFxDone(r, 800));
            while (pausedRef.current && !stale()) await sleep(300);
            if (stale()) return;
            continue;
          }
          break;
        }

        if (!drawnCard && hand.length < 2 && reserveDrawRef.current === pid && stateRef.current.deck.length === 0) {
          const rc = drawReserveCard();
          if (rc) {
            const nm = stateRef.current.players.find(p => p.id === pid).name;
            logActionAndResult(`${nm} 從備用牌抽牌`, '牌庫已空 ➔ 抽 1 張備用牌', nm);
            drawnCard = rc;
          }
        }

        if (stale()) return;
        if (drawnCard) {
          hand = [...hand, drawnCard];
          setHandNow(pid, hand);
        }

        if (hand.length >= 2) {
          const safeCard = aiPickCard(hand);
          if (safeCard) executePlayPhase(pid, safeCard);
          else advanceTurn();
        } else {
          advanceTurn();
        }
      }, 500 * slow(), true);

      return () => { cancelAiWait(); };
    }
  }, [currentTurnIndex, gameOver, aiKick]);

  const myHand = playerHands[humanPlayerId] || [];
  resolveRef.current = resolveCardEffect;

  // 面前的牌：該玩家所有打出（或被公開）而放在面前的牌；同一張牌只列一次
  const getFrontCards = (p) => {
    const map = new Map();
    const order = [];
    (p.playedCards || []).forEach((c, idx) => {
      if (!c) return;
      const key = c.id || `${c.title}-${idx}`;
      const prev = map.get(key);
      if (!prev) order.push(key);
      map.set(key, { ...c, revealedBy: c.revealedBy || (prev && prev.revealedBy) });
    });
    return order.map(k => map.get(k));
  };

  // 長期有效、仍在作用的牌 ➔ 標示「生效中」：僕人、商人、煉金術士、保鏢（保護期間）、
  // 仍握在手上的賞金獵人公開牌、女巫（復活者仍綁定時）
  const isCardActive = (p, c) => {
    if (!p || !c || p.status !== '存活') return false;
    if (c.type === 'SERVANT' || c.title === '商人' || c.title === '煉金術士') return true;
    if (c.type === 'BODYGUARD') return !!p.protected;
    if (c.revealedBy === 'BOUNTY') return (playerHands[p.id] || []).some(h => h && h.id === c.id);
    if (c.title === '女巫') return !!witchTargetOwner && witchTargetOwner.witchOwnerId === p.id;
    return false;
  };

  const handleNextGame = async () => {
    // 本機試玩：一人即開始
    if (!onlineSession || !roomData || !firebaseUser || !roomRef.current) {
      if (winnerInfo && winnerInfo.matchWinners && winnerInfo.matchWinners.length > 0) {
        clearWinsNextRef.current = true;
        winsRef.current = {};
        setWins({});
      }
      initGame();
      return;
    }
    if (nextGameBusy) return;
    // 只有本局已結束才能準備下一局（避免殘留／誤觸的準備旗標在對局中被算進去）
    if (!(roomData.gameState && roomData.gameState.gameOver)) return;
    // 任何仍在房間的真人（含已出局）皆可準備；只寫入自己的 nextReady/{uid}，避免非房主對整房 transaction 被 rules 拒絕
    const myUid = firebaseUser.uid;
    if (!(roomData.players || {})[myUid]) {
      setLobbyError('你不在此房間，無法準備下一局。');
      return;
    }
    if ((roomData.nextReady || {})[myUid]) return;
    setNextGameBusy(true);
    try {
      await firebase.database().ref(`rooms/${roomCode}/nextReady/${myUid}`).set(true);
    } catch (error) {
      setLobbyError(`準備下一局失敗：${error.message}`);
      setBroadcastAction('無法準備下一局');
      setBroadcastResult(`➔ ${error.message}`);
    } finally {
      setNextGameBusy(false);
    }
  };

  // 殘留的「已準備」旗標：本局尚未結束（或新局已開始）時，清掉自己的旗標，避免上一局／斷線重送的準備被算進這一局
  useEffect(() => {
    if (!onlineSession || !roomData || !firebaseUser || !roomCode || !window.firebase) return;
    const myUid = firebaseUser.uid;
    if (!(roomData.nextReady && roomData.nextReady[myUid])) return;
    if (roomData.gameState && roomData.gameState.gameOver) return;
    firebase.database().ref(`rooms/${roomCode}/nextReady/${myUid}`).remove().catch(() => {});
  }, [onlineSession, roomCode, firebaseUser, roomData && roomData.nextReady, roomData && roomData.gameState && roomData.gameState.gameOver]);

  // 房主偵測全員準備後開新局（僅房主可寫房間根欄位 round／gameState）
  useEffect(() => {
    if (!onlineSession || !roomData || !firebaseUser || !roomRef.current || !roomCode) return;
    if (roomData.hostUid !== firebaseUser.uid) return;
    if (roomData.status !== 'playing') return;
    if (!(roomData.gameState && roomData.gameState.gameOver)) return; // 本局未結束 → 一律不開新局
    const humans = Object.keys(roomData.players || {});
    if (!humans.length) return;
    const nextReady = roomData.nextReady || {};
    if (!humans.every(uid => nextReady[uid])) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await roomRef.current.transaction(current => {
          if (!current || current.status !== 'playing') return;
          if (!(current.gameState && current.gameState.gameOver)) return;
          const h = Object.keys(current.players || {});
          if (!h.length) return;
          const nr = current.nextReady || {};
          if (!h.every(uid => nr[uid])) return;
          return {
            ...current,
            nextReady: null,
            round: (current.round || 0) + 1,
            gameState: null,
          };
        });
        if (cancelled) return;
        if (result.committed) {
          const after = result.snapshot && result.snapshot.val();
          if (after && !after.gameState && winnerInfo && winnerInfo.matchWinners && winnerInfo.matchWinners.length > 0) {
            clearWinsNextRef.current = true;
            winsRef.current = {};
            setWins({});
          }
          // 全員準備後立刻由房主發牌（不單靠 roomData 訂閱／round effect，避免整場結束後 Guest 卡在「等待房主發牌」）
          const roster = (after && after.gamePlayers) || (roomData && roomData.gamePlayers) || INITIAL_PLAYERS;
          setTimeout(() => {
            if (cancelled) return;
            // 新局 gameState 已清空；強制歸零後發牌（不可因上局 revision 殘留而跳過）
            gameRevisionRef.current = 0;
            initGame(roster);
          }, 80);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('開下一局失敗：', error);
          setLobbyError(`開下一局失敗：${error.message}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onlineSession, roomCode, firebaseUser, roomData && roomData.hostUid, roomData && roomData.status, roomData && roomData.nextReady, roomData && roomData.players, roomData && roomData.gameState && roomData.gameState.gameOver]);
  const onlineHumans = roomData ? Object.keys(roomData.players || {}) : [];
  const nextReadyMap = (roomData && roomData.nextReady) || {};
  const iAmReadyNext = !!(firebaseUser && nextReadyMap[firebaseUser.uid]);
  const nextReadyCount = onlineHumans.filter(uid => nextReadyMap[uid]).length;
  const allReadyNext = onlineSession && onlineHumans.length > 0 && nextReadyCount >= onlineHumans.length;
  const canStartNextGame = !onlineSession || !!(firebaseUser && onlineHumans.includes(firebaseUser.uid));
  const nextGameLabel = nextGameBusy
    ? '處理中…'
    : !onlineSession
      ? ((winnerInfo && winnerInfo.matchWinners && winnerInfo.matchWinners.length > 0) ? '開始新的一場' : '下一局')
      : iAmReadyNext
        ? (allReadyNext ? '即將開始…' : `已準備 ${nextReadyCount}/${onlineHumans.length}`)
        : ((winnerInfo && winnerInfo.matchWinners && winnerInfo.matchWinners.length > 0)
          ? `準備新的一場（${nextReadyCount}/${onlineHumans.length}）`
          : `準備下一局（${nextReadyCount}/${onlineHumans.length}）`);

  // 結算後攤牌：單張牌的小標籤
  const revealChip = (c, key) => c ? (
    <span key={key} className="inline-flex items-center bg-slate-800 border border-amber-500/40 rounded px-1.5 py-0.5 text-[10.5px] whitespace-nowrap">{numEmoji(c.value)}<b className="font-black text-amber-300 ml-0.5">{c.title}</b></span>
  ) : (
    <span key={key} className="inline-flex items-center bg-slate-800/50 border border-dashed border-slate-600 rounded px-1.5 py-0.5 text-[10px] text-slate-500 whitespace-nowrap">已取走</span>
  );

  if (screen !== 'game') {
    const humans = roomData ? Object.values(roomData.players || {}).sort((a, b) => a.joinedAt - b.joinedAt) : [];
    const aiCount = roomData ? roomData.aiCount || 0 : 0;
    const totalPlayers = humans.length + aiCount;
    const isHost = !!(roomData && firebaseUser && roomData.hostUid === firebaseUser.uid);
    return (
      <div className="lobby-shell h-[100dvh] w-screen bg-slate-950 text-slate-100 overflow-y-auto overflow-x-hidden">
        <div className="w-full max-w-md mx-auto min-h-full flex flex-col justify-center p-4 box-border">
          <div className="text-center mb-4 shrink-0">
            <div className="text-4xl mb-1">🌙</div>
            <h1 className="text-3xl font-black tracking-widest text-amber-300">狼月</h1>
            <p className="text-xs text-slate-400 mt-1">Wolf Moon · 線上多人版</p>
            <p className="text-[10px] font-mono font-bold text-cyan-400/90 mt-1.5 tracking-tight">{version}</p>
          </div>
          <div className="flex items-center justify-center gap-2 mb-3 text-[10px] font-bold shrink-0">
            {['1 名稱／房間', '2 等待大廳', '3 遊戲'].map((label, index) => (
              <div key={label} className={`rounded-full px-2.5 py-1 border ${index === (screen === 'home' ? 0 : 1) ? 'border-amber-400/70 bg-amber-500/15 text-amber-200' : 'border-slate-700 text-slate-500'}`}>{label}</div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/90 p-5 shadow-2xl">
            {screen === 'home' ? (
              <>
                <label className="block text-xs font-bold text-slate-300 mb-1.5" htmlFor="player-name">玩家名稱</label>
                <input
                  id="player-name"
                  value={displayName}
                  onChange={event => { setDisplayName(event.target.value); setLobbyError(''); }}
                  onKeyDown={event => { if (event.key === 'Enter' && firebaseStatus === 'ready') createRoom(); }}
                  maxLength={16}
                  placeholder="輸入 1–16 字名稱"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-400"
                />
                <button
                  onClick={createRoom}
                  disabled={lobbyBusy || firebaseStatus !== 'ready'}
                  className="w-full mt-4 rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 disabled:opacity-40"
                >{lobbyBusy ? '處理中…' : '建立房間'}</button>
                <div className="my-4 flex items-center gap-3 text-[10px] text-slate-500"><span className="h-px flex-1 bg-slate-700"></span>或加入朋友的房間<span className="h-px flex-1 bg-slate-700"></span></div>
                <div className="flex gap-2">
                  <input
                    value={roomInput}
                    onChange={event => { setRoomInput(event.target.value.replace(/\D/g, '').slice(0, 6)); setLobbyError(''); }}
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="6 位數字房間號碼"
                    aria-label="房間號碼"
                    className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-center font-mono text-lg tracking-[0.3em] text-white outline-none focus:border-cyan-400"
                  />
                  <button
                    onClick={joinRoom}
                    disabled={lobbyBusy || firebaseStatus !== 'ready'}
                    className="rounded-xl border border-cyan-500/50 bg-cyan-950/60 px-4 text-sm font-black text-cyan-200 disabled:opacity-40"
                  >加入</button>
                </div>
                {firebaseStatus === 'setup' && (
                  <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-[11px] leading-relaxed text-amber-100">
                    Firebase 尚未設定。請先依 read.md 建立 Firebase 專案、啟用匿名登入與 Realtime Database，再填入本頁的 Web App config。
                  </div>
                )}
                {firebaseStatus === 'connecting' && <p className="mt-3 text-center text-[10px] text-slate-400">正在連接 Firebase…</p>}
                {firebaseStatus === 'error' && <p className="mt-3 text-center text-[10px] text-rose-300">Firebase 連線失敗，請檢查設定與網路。</p>}
                <button onClick={() => { setOnlineSession(false); setScreen('game'); }} className="w-full mt-4 py-2 text-[11px] font-bold text-slate-400 underline underline-offset-4">本機試玩（不連線）</button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400">房間號碼</div>
                    <div className="font-mono text-3xl font-black tracking-[0.25em] text-amber-300">{roomCode}</div>
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(roomCode).catch(error => setLobbyError(`複製房間號碼失敗：${error.message}`))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300">複製</button>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-4">
                  <h2 className="text-sm font-black text-white">等待大廳</h2>
                  <span className={`text-xs font-black ${totalPlayers >= 3 ? 'text-emerald-300' : 'text-amber-300'}`}>{totalPlayers} / 6 人</span>
                </div>
                {/* AI 調整固定在名單上方，避免增減時按鈕跟著下移 */}
                {isHost && roomData.status === 'lobby' && (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-700 p-3">
                    <div>
                      <div className="text-xs font-bold">AI 玩家</div>
                      <div className="text-[10px] text-slate-400">總玩家數需為 3–6 人</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => updateAiCount(-1)} disabled={aiCount <= 0} className="h-8 w-8 rounded-lg bg-slate-700 font-black disabled:opacity-30" aria-label="減少 AI">−</button>
                      <span className="w-4 text-center font-mono font-black">{aiCount}</span>
                      <button onClick={() => updateAiCount(1)} disabled={totalPlayers >= 6} className="h-8 w-8 rounded-lg bg-slate-700 font-black disabled:opacity-30" aria-label="增加 AI">＋</button>
                    </div>
                  </div>
                )}
                <div className="lobby-player-list mt-2 space-y-2 max-h-[40vh] overflow-y-auto pr-0.5 scrollbar-none">
                  {humans.map(person => (
                    <div key={person.uid} className="flex items-center justify-between rounded-lg bg-slate-800/70 px-3 py-2 text-sm">
                      <span className="truncate">{person.name}</span>
                      {person.uid === roomData.hostUid && <span className="ml-2 text-[10px] font-bold text-amber-300">房主</span>}
                    </div>
                  ))}
                  {Array.from({ length: aiCount }, (_, index) => (
                    <div key={`ai-${index}`} className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2 text-sm text-cyan-200">
                      <span>AI {index + 1}</span><span className="text-[10px]">電腦玩家</span>
                    </div>
                  ))}
                </div>
                {isHost && roomData.status === 'lobby' && (
                  <div className="lobby-start-bar sticky bottom-0 -mx-1 mt-4 bg-slate-900/95 pt-2 pb-1 z-10">
                    <button onClick={startOnlineGame} disabled={totalPlayers < 3 || totalPlayers > 6} className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 active:scale-95">開始遊戲</button>
                  </div>
                )}
                {roomData.status === 'playing' && (
                  <div className="mt-4 space-y-2">
                    <p className="text-center text-[11px] text-amber-200 font-bold">本局進行中或已結束</p>
                    <button onClick={() => setScreen('game')} className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-black text-white active:scale-95">返回牌桌</button>
                    {(roomData.gameState && roomData.gameState.gameOver) ? (
                      <button
                        onClick={handleNextGame}
                        disabled={nextGameBusy || iAmReadyNext}
                        className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 active:scale-95"
                      >{nextGameLabel}</button>
                    ) : null}
                  </div>
                )}
                {!isHost && roomData.status === 'lobby' && (
                  <p className="mt-4 text-center text-xs text-slate-400">等待房主開始遊戲…</p>
                )}
                <button onClick={leaveRoom} className="w-full mt-3 py-2 text-[11px] font-bold text-rose-300">離開房間</button>
              </>
            )}
            {lobbyError && <p role="alert" className="mt-3 rounded-lg bg-rose-950/50 p-2 text-[11px] text-rose-200">{lobbyError}</p>}
          </div>
          <p className="mt-3 text-center text-[9px] text-slate-600">休閒同步模式：介面會遮蔽他人私密資訊，但熟悉瀏覽器工具的玩家仍可能讀取同步資料。</p>
        </div>
      </div>
    );
  }

  const privateBroadcastVisible = !!(broadcastPrivate && broadcastPrivate.playerIds?.includes(humanPlayerId));
  const visibleBroadcastAction = privateBroadcastVisible ? broadcastPrivate.action : broadcastAction;
  // 動態私密行依本機玩家從 swapMeta／drunkMeta 重新組裝，避免同步到出牌者個人化後的「你換出／換入」
  const visibleBroadcastResult = privateBroadcastVisible
    ? (broadcastPrivate.drunkMeta
        ? `➔ ${formatDrunkResultForViewer(String(broadcastPrivate.result || '').replace(/^➔\s*/, '').split('｜')[0], broadcastPrivate.drunkMeta, humanPlayerId)}`
        : broadcastPrivate.swapMeta
          ? `➔ ${formatSwapResultForViewer(String(broadcastPrivate.result || '').replace(/^➔\s*/, '').split('｜')[0], broadcastPrivate.swapMeta, humanPlayerId)}`
          : broadcastPrivate.result)
    : broadcastResult;
  const visibleBroadcastReveal = privateBroadcastVisible ? broadcastPrivate.reveal : broadcastReveal;
  const visibleWatchNote = watchNote?.byPlayer
    ? watchNote.byPlayer[humanPlayerId] || null
    : (watchNote?.ownerId === humanPlayerId ? watchNote : null);
  const visibleHistoryLogs = (Array.isArray(historyLogs) ? historyLogs : []).map(log => {
    const privateView = log.privateView && log.privateView.playerIds?.includes(humanPlayerId) ? log.privateView : null;
    const privateFx = log.privateFx?.privateTo?.includes(humanPlayerId) ? log.privateFx : null;
    const legacySecret = !log.privateView && PRIVATE_TEXT_PATTERN.test(`${log.action || ''} ${log.result || log.card || ''}`);
    const personalizedResult = privateView
      ? (privateView.swapMeta
          ? formatSwapResultForViewer(String(privateView.result || '').split('｜')[0], privateView.swapMeta, humanPlayerId)
          : privateView.drunkMeta
            ? formatDrunkResultForViewer(String(privateView.result || '').split('｜')[0], privateView.drunkMeta, humanPlayerId)
            : privateView.result)
      : (legacySecret ? '私密行動已完成' : log.result);
    return {
      ...log,
      action: privateView ? privateView.action : log.action,
      result: personalizedResult,
      reveal: privateView ? privateView.reveal : log.reveal,
      card: legacySecret ? (log.action || '私密行動已完成') : log.card,
      fx: legacySecret ? null : (privateFx || log.fx),
      isPrivateForViewer: !!privateView,
    };
  });

  // 線上模式尚未收到牌局：顯示等待，避免誤顯示預設 6 人 AI 空桌
  if (onlineSession && !gameReady) {
    return (
      <div className="min-h-[100dvh] h-[100dvh] w-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-6 text-center">
        <div className="text-4xl mb-3 animate-pulse">🌙</div>
        <p className="text-sm font-black text-amber-300 mb-1">正在同步牌局…</p>
        <p className="text-[11px] text-slate-400 mb-4">等待房主發牌與狀態同步</p>
        <p className="text-[10px] font-mono text-cyan-400/80 mb-6">{version}{roomCode ? ` · 房 ${roomCode}` : ''}</p>
        <button
          onClick={() => setScreen('lobby')}
          className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-300"
        >返回大廳</button>
      </div>
    );
  }

  return (
    <div className="game-shell text-slate-100 select-none touch-manipulation pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div
        className="game-scale-frame"
        style={{ width: GAME_DESIGN_W * gameScale, height: GAME_DESIGN_H * gameScale }}
      >
      <div
        className="mobile-container flex flex-col justify-between bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 relative overflow-hidden"
        style={{
          width: GAME_DESIGN_W,
          height: GAME_DESIGN_H,
          transform: `scale(${gameScale})`,
          transformOrigin: 'top left',
        }}
      >

        <GameBoard
          {...{
            actionLocked, arenaFocus, arenaRef, broadcastEvent, canStartNextGame, centerCards,
            changeSpeed, closeReplay, currentTurnIndex, deck, dragGhost, drawAnim, drunkSeen, fx,
            gameOver, getFrontCards, handleActionA, handleActionB, handleHandPointerCancel,
            handleHandPointerDown, handleHandPointerMove, handleHandPointerUp, handleNextGame,
            humanPlayerId, humanPlayerName, iAmReadyNext, isCardActive, isMyTurn,
            isReturningCenterCard, lastBroadcastFx, moonPhase, myHand, nextGameBusy, nextGameLabel,
            onlineSession, otherPlayersOrdered, playBroadcastFx, playedCardArena, playerHands,
            players, privateBroadcastVisible, recentArenaCards, replay, reserveCards,
            reserveDrawRef, revealChip, seerSeen, selectedHandCard, setArenaFocus,
            setCenterPickMode, setIsCenterCardsModalOpen, setIsDeckModalOpen, setIsHistoryModalOpen,
            setIsRulesModalOpen, setOnlineSession, setScreen, setShowBroadcast, setVictoryDismissed,
            showBroadcast, skipFx, speed, version, victoryDismissed, visibleBroadcastAction,
            visibleBroadcastResult, visibleBroadcastReveal, winnerInfo, wins, witchTargetOwner,
          }}
        />
      </div>
      </div>

      {/* 互動彈窗: 人類玩家發動能力標的與數值選擇 */}
      {interactionModal && (
        <InteractionDialog 
          modal={interactionModal} 
          players={players} 
          humanPlayerId={humanPlayerId}
          playerHands={playerHands}
          centerCards={centerCards}
          remainingCounts={remainingCounts}
          allCards={ALL_CARDS}
          onSubmit={handleHumanInteractionSubmit}
          onCancel={() => { 
            // 取消時：收回剛才準備打出的牌，完全不執行效果並還原至兩張手牌狀態
            if (interactionModal.type === 'COUNTER_SPY') {
              const m = interactionModal;
              setInteractionModal(null);
              executeGuess(m.sourceId, m.targetId, m.guessedValue, m.isAssassin, true, m.secondGuess);
              return;
            }
            if (interactionModal.type === 'SERVANT_CHOICE') { setInteractionModal(null); proceedToNext(); return; }
            if (interactionModal.type === 'DRUNK_VIEW') {
              // 已看過手牌，不能取消：強制洗牌重發，並在此時才推 C 區
              setInteractionModal(null);
              commitPendingArena();
              doDrunkDeal(humanPlayerId);
              return;
            }
            if (interactionModal.type === 'INFO') { setInteractionModal(null); advanceTurn(); return; }
            const playedCard = interactionModal.card;
            lockRef.current = false;
            setActionLocked(false);
            setInteractionModal(null);
            pendingArenaCardRef.current = null; // 取消：不展示到 C 區
            if (playedCard) {
              setPlayerHands(prev => {
                const currentHand = prev[humanPlayerId] || [];
                if (!currentHand.some(c => c?.id === playedCard.id)) {
                  return { ...prev, [humanPlayerId]: [...currentHand, playedCard] };
                }
                return prev;
              });
              // 移除面前剛剛宣告打出的卡牌
              setPlayers(prev => prev.map(p => p.id === humanPlayerId ? { ...p, playedCards: (p.playedCards || []).filter(c => c?.id !== playedCard.id) } : p));
              setPlayedCardArena(null);
            }
            setSelectedHandCard(null);
            setBroadcastAction('已取消發動能力');
            setBroadcastResult('➔ 請重新選擇要打出的手牌');
          }}
        />
      )}

      {/* 遊戲結束勝利彈窗 */}
      {gameOver && winnerInfo && victoryReady && !victoryDismissed && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[120] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-amber-400/80 rounded-2xl w-full max-w-xs p-5 shadow-2xl text-center relative overflow-y-auto max-h-[90vh]">
            <i className="fa-solid fa-trophy text-5xl text-amber-400 mb-3 filter drop-shadow"></i>
            <h2 className="text-xl font-black text-amber-300 mb-1">【{winnerInfo.winnerName}】</h2>
            <p className="text-xs text-emerald-300 font-bold mb-3">{winnerInfo.reason}</p>
            {winnerInfo.matchWinners && winnerInfo.matchWinners.length > 0 && (
              <p className="text-[11px] text-amber-300 font-black mb-3"><i className="fa-solid fa-moon mr-1"></i>【{winnerInfo.matchWinners.join(' & ')}】累計 {winnerInfo.winsNeeded || 2} 個月亮標記，贏得整場！</p>
            )}
            {winnerInfo.scores && Array.isArray(winnerInfo.scores.rows) && winnerInfo.scores.rows.length > 0 && (
              <div className="text-left bg-slate-900/70 border border-slate-700 rounded-lg p-2 mb-3 space-y-1">
                <div className="text-[10px] font-black text-cyan-300">{winnerInfo.scores.title}</div>
                {winnerInfo.scores.rows.map(r => (
                  <div key={r.id} className={`text-[10.5px] leading-snug ${r.win ? 'text-amber-200 font-black' : 'text-slate-300'}`}>
                    {r.win ? '🏆 ' : '　'}<RichLog text={r.text} nameClass={r.win ? 'text-white' : 'text-amber-300'} />
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setVictoryDismissed(true)}
              className="w-full mb-2 bg-slate-800 hover:bg-slate-700 text-purple-300 font-bold text-xs py-2 rounded-xl border border-purple-500/40 active:scale-95 transition"
            >
              <i className="fa-solid fa-eye mr-1"></i>返回牌桌查看
            </button>
            <button 
              onClick={handleNextGame} 
              disabled={!canStartNextGame || nextGameBusy || (onlineSession && iAmReadyNext)}
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm py-2.5 rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {nextGameLabel}
            </button>
          </div>
        </div>
      )}

      {/* 彈窗：遊戲規則與角色技能 */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4" onClick={() => setIsRulesModalOpen(false)}>
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl w-full max-w-sm p-4 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-3">
              <div className="flex items-center space-x-2">
                <i className="fa-solid fa-book-open text-amber-400"></i>
                <h3 className="text-sm font-bold text-amber-300">遊戲規則與角色技能</h3>
              </div>
              <button onClick={() => setIsRulesModalOpen(false)} className="text-slate-400 hover:text-white text-base">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1 text-xs scrollbar-none">
              {RULES_SECTIONS.map(sec => (
                <div key={sec.title}>
                  <div className="text-[11px] font-black text-cyan-300 mb-1">{sec.title}</div>
                  <ul className="space-y-1 text-[11px] text-slate-300 leading-snug list-disc pl-4">
                    {sec.items.map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                </div>
              ))}
              <div>
                <div className="text-[11px] font-black text-cyan-300 mb-1">角色技能（數值 0–10）</div>
                <div className="space-y-1">
                  {RULES_CARDS.map((c, i) => (
                    <div key={i} className="flex items-start space-x-2 bg-slate-800/50 rounded p-1.5">
                      <span className="bg-amber-500 text-slate-950 text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-mono">{c.v}</span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-slate-100">{c.name}</div>
                        <div className="text-[10px] text-slate-400 leading-snug">{c.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 彈窗 1：牌庫角色清單（初始牌庫包含3張月亮牌） */}
      {isDeckModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/50 rounded-2xl w-full max-w-xs p-4 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-3">
              <div className="flex items-center space-x-2">
                <i className="fa-solid fa-layer-group text-cyan-400"></i>
                <h3 className="text-sm font-bold text-cyan-300">牌庫清單</h3>
              </div>
              <button onClick={() => setIsDeckModalOpen(false)} className="text-slate-400 hover:text-white text-base">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1 text-xs scrollbar-none">
              {ALL_CARDS.map((card, idx) => {
                const counts = remainingCounts[card.title] || { current: card.totalCount, total: card.totalCount };
                const isUsedUp = counts.current === 0;
                return (
                  <div key={idx} className={`flex justify-between items-center p-1.5 rounded ${isUsedUp ? 'bg-red-950/30 opacity-50' : 'bg-slate-800/50'}`}>
                    <div className="flex items-center space-x-2">
                      <span className={`text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-mono ${isUsedUp ? 'bg-red-900 text-red-300' : 'bg-slate-700 text-slate-300'}`}>{card.value}</span>
                      <span className={`font-bold ${isUsedUp ? 'text-red-400 line-through' : 'text-slate-200'}`}>{card.title}</span>
                    </div>
                    <span className={`font-mono font-bold ${isUsedUp ? 'text-red-500' : 'text-cyan-400'}`}>
                      {counts.current} / {counts.total}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between items-center px-1.5 pt-2 pb-0.5 border-t border-slate-700/70 mt-1">
                <span className="text-[11px] font-black text-amber-300"><i className="fa-solid fa-moon mr-1"></i>月亮牌</span>
                <span className="font-mono font-bold text-amber-400">剩 {deck.filter(c => c && c.isMoon).length} / 3 張</span>
              </div>
              {MOON_CARDS.map(m => {
                const left = deck.filter(c => c && c.isMoon && c.level === m.level).length;
                const used = left === 0;
                return (
                  <div key={m.level} className={`flex justify-between items-center p-1.5 rounded ${used ? 'bg-red-950/30 opacity-50' : 'bg-slate-800/50'}`}>
                    <div className="flex items-center space-x-2">
                      <span className={`text-[9px] w-4 h-4 rounded-full flex items-center justify-center ${used ? 'bg-red-900 text-red-300' : 'bg-slate-700 text-amber-300'}`}><i className="fa-solid fa-moon"></i></span>
                      <span className={`font-bold ${used ? 'text-red-400 line-through' : 'text-slate-200'}`}>{m.title}</span>
                    </div>
                    <span className={`font-mono font-bold ${used ? 'text-red-500' : 'text-amber-400'}`}>{left} / 1</span>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setIsDeckModalOpen(false)} className="w-full mt-4 bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs py-2 rounded-xl border border-slate-700 transition">
              關閉
            </button>
          </div>
        </div>
      )}

      {/* 彈窗 2：歷史紀錄 */}
      {isHistoryModalOpen && (
        <div className="fixed inset-x-0 top-0 h-[100dvh] bg-slate-950/80 backdrop-blur-sm z-[120] flex items-center justify-center p-3">
          <div className="bg-slate-900 border border-purple-500/50 rounded-2xl w-full max-w-xs h-full flex flex-col p-4 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-3 shrink-0">
              <div className="flex items-center space-x-2">
                <i className="fa-solid fa-clock-rotate-left text-purple-400"></i>
                <h3 className="text-sm font-bold text-purple-300">行動紀錄</h3>
              </div>
              <button onClick={() => setIsHistoryModalOpen(false)} className="text-slate-400 hover:text-white text-base">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="history-scroll flex-1 min-h-0 space-y-2 pr-1 text-xs scrollbar-none">
              {visibleHistoryLogs.length > 0 ? visibleHistoryLogs.map(log => {
                const bodyText = `${log.action !== undefined ? log.action : log.card}${log.result || ''}${log.reveal || ''}`;
                // 每位玩家各自判斷「涉及自己」（含被出牌、被換牌、出局／復活等）
                const mine = log.player === '你'
                  || (humanPlayerName && log.player === humanPlayerName)
                  || log.isPrivateForViewer
                  || /你/.test(bodyText)
                  || (humanPlayerName && bodyText.includes(humanPlayerName));
                // 左：出局紅／復活綠／其他紫；涉及自己再加右黃邊（出局也保留紅＋右黃）
                const left = log.event === 'out'
                  ? 'border-l-2 border-rose-500 bg-rose-950/30 shadow-[0_0_12px_rgba(244,63,94,0.5)]'
                  : log.event === 'revive'
                    ? 'border-l-2 border-emerald-400 bg-emerald-950/30 shadow-[0_0_12px_rgba(52,211,153,0.5)]'
                    : 'border-l-2 border-purple-400 bg-slate-800/60';
                const right = mine ? 'border-r-[3px] border-r-yellow-400' : '';
                return (
                  <div key={log.id} onClick={log.fx ? () => playLogFx(log.fx) : undefined} className={`p-2 rounded flex flex-col ${left} ${right} ${log.fx ? 'cursor-pointer active:brightness-125' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-purple-300 font-bold flex items-center gap-2">{(log.player === '你' || (humanPlayerName && log.player === humanPlayerName)) ? '你' : log.player}{log.isPrivateForViewer && <span className="text-[9px] text-sky-300"><i className="fa-solid fa-lock mr-0.5"></i>僅你可見</span>}{log.fx && <span className="text-[9px] text-sky-300 font-black"><i className="fa-solid fa-play mr-0.5"></i>點擊看動畫</span>}</div>
                      {log.event && (
                        <span className={`flex items-center text-[9px] font-black ${log.event === 'out' ? 'text-rose-300' : 'text-emerald-300'}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 animate-pulse ${log.event === 'out' ? 'bg-rose-400' : 'bg-emerald-400'}`}></span>{log.event === 'out' ? '出局' : '復活'}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-200 font-semibold"><RichLog text={log.action !== undefined ? log.action : log.card} nameClass="text-amber-300" localPlayerName={onlineSession ? humanPlayerName : null} /></div>
                    {log.action !== undefined && log.result && <div className="text-amber-300 font-bold mt-0.5 whitespace-pre-line">➔ <RichLog text={log.result} nameClass="text-amber-300" localPlayerName={onlineSession ? humanPlayerName : null} /></div>}
                    {log.reveal && <div className="text-fuchsia-300 font-bold mt-0.5"><i className="fa-solid fa-eye mr-1"></i><RichLog text={log.reveal} nameClass="text-fuchsia-100" localPlayerName={onlineSession ? humanPlayerName : null} /></div>}
                  </div>
                );
              }) : (
                <div className="text-center text-slate-500 py-4">尚無紀錄</div>
              )}
            </div>
            <button onClick={() => setIsHistoryModalOpen(false)} className="w-full mt-3 shrink-0 bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs py-2 rounded-xl border border-slate-700 transition">
              關閉
            </button>
          </div>
        </div>
      )}

      {/* 長按放大的手牌（放開即關閉） */}
      {zoomCard && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/70 pointer-events-none">
          <div className="w-[250px] h-[360px] bg-slate-900 border-2 border-cyan-400 rounded-2xl p-4 flex flex-col justify-between shadow-[0_0_30px_rgba(6,182,212,0.5)]">
            <div className="flex justify-between items-center">
              <span className="bg-cyan-500 text-slate-950 text-xl font-black w-10 h-10 rounded-full flex items-center justify-center font-mono">{zoomCard.value}</span>
              <span className="text-[11px] text-slate-400 font-bold">{zoomCard.category}</span>
            </div>
            <div className="w-full h-32 bg-slate-800/90 rounded-xl border border-slate-700/60 flex items-center justify-center my-2">
              <i className={`fa-solid ${zoomCard.icon} text-6xl text-cyan-400 filter drop-shadow`}></i>
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-slate-100 tracking-wide">{zoomCard.title}</div>
              <div className="text-sm text-slate-300 leading-snug mt-2">{zoomCard.desc}</div>
            </div>
          </div>
        </div>
      )}

      {/* 拖曳中的手牌（浮動，不影響版面） */}
      {dragGhost && (
        <div className="fixed z-[70] pointer-events-none" style={{ left: dragGhost.x, top: dragGhost.y, transform: 'translate(-50%, -60%) rotate(-3deg) scale(0.9)' }}>
          <div className={`w-[130px] h-[190px] bg-slate-900 border-2 rounded-xl p-2 flex flex-col justify-between shadow-2xl ${dragGhost.over ? 'border-emerald-400 shadow-[0_0_22px_rgba(52,211,153,0.7)]' : 'border-amber-400'}`}>
            <div className="flex justify-between items-center">
              <span className="bg-amber-500 text-slate-950 text-sm font-black w-6 h-6 rounded-full flex items-center justify-center font-mono">{dragGhost.card.value}</span>
            </div>
            <div className="w-full h-16 bg-slate-800/90 rounded-lg border border-slate-700/60 flex items-center justify-center my-1">
              <i className={`fa-solid ${dragGhost.card.icon} text-3xl text-amber-400`}></i>
            </div>
            <div className="text-center">
              <div className="text-xs font-black text-slate-100 truncate">{dragGhost.card.title}</div>
              <div className="text-[8.5px] text-slate-300 line-clamp-3 leading-tight mt-0.5">{dragGhost.card.desc}</div>
            </div>
          </div>
        </div>
      )}

      {/* 彈窗 3：暗牌區檢視／拿一還一選牌（放大版） */}
      {isCenterCardsModalOpen && (() => {
        const nameOf = (id) => id === humanPlayerId ? '你' : ((players.find(p => p.id === id) || {}).name || '?');
        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[120] flex items-center justify-center p-3">
            <div className="bg-slate-900 border border-amber-500/50 rounded-2xl w-full max-w-md p-5 shadow-2xl relative max-h-[92dvh] overflow-y-auto">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-3">
                <div className="flex items-center space-x-2">
                  <i className="fa-solid fa-moon text-amber-400 text-lg"></i>
                  <h3 className="text-base font-bold text-amber-300">{centerPickMode ? '拿一還一：選擇要拿的暗牌' : '桌面暗牌區'}</h3>
                </div>
                <button onClick={closeCenterModal} className="text-slate-400 hover:text-white text-xl px-1">
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              <div className="text-[12px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-4 leading-snug">
                <i className="fa-solid fa-circle-info mr-1"></i>
                {centerPickMode
                  ? '拿一還一：選 1 格暗牌拿走，再放回 1 張手牌到同一格；放回後直接結束回合。'
                  : '拿一還一：選 1 格暗牌拿走，再放回 1 張手牌到同一格；放回後直接結束回合。'}
              </div>

              <div className="grid grid-cols-3 gap-3 py-1">
                {centerMeta.map((m, i) => {
                  const card = centerCards[i];
                  const knowledge = centerKnowledge(m)[humanPlayerId];
                  const known = !!(knowledge && knowledge.card);
                  const stale = known && knowledge.stale;
                  const selectable = centerPickMode && !!card;
                  const selected = pickSlot === i;
                  return (
                    <div key={i} className="flex flex-col items-center">
                      <button
                        disabled={!selectable}
                        onClick={() => setPickSlot(i)}
                        className={`w-full h-36 flex flex-col items-center justify-center relative transition rounded-xl border ${
                          selected ? 'border-amber-400 bg-amber-500/10' : 'border-slate-700/60 bg-slate-800/40'
                        } ${!card ? 'opacity-60' : ''} ${selected ? 'drop-shadow-[0_0_12px_rgba(245,158,11,0.95)]' : ''} ${selectable ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}
                      >
                        {!card ? (
                          <span className="text-xs text-slate-400">已取走</span>
                        ) : known ? (
                          <div className={`flex flex-col items-center ${stale ? 'opacity-50' : ''}`}>
                            <span className="bg-cyan-500 text-slate-950 text-sm font-black w-7 h-7 rounded-full flex items-center justify-center font-mono">{knowledge.card.value}</span>
                            <i className={`fa-solid ${knowledge.card.icon} text-2xl text-cyan-300 my-1.5`}></i>
                            <span className="text-[12px] font-black text-slate-100 leading-tight">{knowledge.card.title}</span>
                            <span className="text-[10px] text-amber-300 mt-1">{stale ? '舊資訊' : '你看過'}</span>
                          </div>
                        ) : (
                          <FxBack cls="w-20 h-[112px]" moonCls="text-2xl" label="未知" />
                        )}
                      </button>
                      <span className="text-[12px] text-amber-300 font-bold mt-2">暗牌 {i + 1}</span>
                      <div className="text-[10px] leading-tight text-center mt-0.5 space-y-0.5 w-full">
                        {m.swappedBy.length > 0
                          ? <div className="text-rose-300 break-words"><i className="fa-solid fa-right-left mr-0.5"></i>{m.swappedBy.map(nameOf).join('、')}</div>
                          : <div className="text-slate-500">未被換過</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-400 mt-3 leading-snug">
                <i className="fa-solid fa-right-left text-rose-300 mr-0.5"></i>換過（拿一還一）。「舊資訊」＝你看過的暗牌，之後有人動過，內容未必還是原本那張。
              </p>
              {watchLog.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {watchLog.map(w => (
                    <p key={w.id} className="text-[11px] text-sky-300 leading-snug"><i className="fa-solid fa-binoculars mr-0.5"></i>守夜人：{nameOf(w.pid)} 看過 3 張、換過 1 張（不知哪一格，順序已洗）</p>
                  ))}
                </div>
              )}
              {visibleWatchNote && visibleWatchNote.text && (
                <p className={`text-[11px] mt-1.5 leading-snug ${visibleWatchNote.stale ? 'text-slate-500' : 'text-cyan-300'}`}>
                  <i className="fa-solid fa-binoculars mr-0.5"></i>{visibleWatchNote.text}{visibleWatchNote.stale ? '（舊資訊）' : ''}
                </p>
              )}

              {centerPickMode ? (
                <div className="flex space-x-2 mt-4">
                  <button disabled={pickSlot === null} onClick={() => confirmTakeCenter(pickSlot)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-xl">
                    {pickSlot !== null ? `拿取暗牌 ${pickSlot + 1}` : '請先選一格暗牌'}
                  </button>
                  <button onClick={closeCenterModal} className="bg-slate-800 text-slate-300 text-sm px-4 py-2.5 rounded-xl border border-slate-700">取消</button>
                </div>
              ) : (
                <>
                  <div className="h-3"></div>
                  <button onClick={closeCenterModal} className="w-full bg-slate-800 hover:bg-slate-700 text-amber-300 text-sm font-bold py-2.5 rounded-xl border border-slate-700 transition">
                    關閉
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

export default App;
