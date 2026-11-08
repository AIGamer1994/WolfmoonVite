# 拆檔後的專案說明

## 想改什麼 → 去哪個檔案

| 想改的東西 | 檔案 |
|---|---|
| 卡牌名稱、說明文字、數值、圖示 | `src/data/cards.js` |
| 玩家名稱、emoji、頭像漸層色 | `src/data/players.js` |
| 規則彈窗的文字 | `src/data/rules.js` |
| 動畫印章文字（淘汰／失敗／平手…）、被動牌「無效果」原因、動畫長度 | `src/fx/fxConfig.js` |
| 整體介面配色（底色、金、綠、紅） | `public/tailwind-theme.js` |
| 動畫的發光／邊框顏色（紅、綠、金、藍…） | `src/styles/theme.css`（改一處，全部動畫跟著變） |
| 全域樣式（最外層背景、選中手牌效果、桌面兩側邊框） | `src/styles/index.css` |
| 動畫的影格與時間曲線 | `src/styles/cards.css`、`src/styles/finale.css` |
| 月亮／吸血鬼結局演出（顏色與文字寫在 JSX 內） | `src/fx/finale.jsx` |
| 「打出牌後的動畫」版面 | `src/fx/cards.jsx` |
| 互動對話框（選目標、猜數字）的文字與樣式 | `src/components/InteractionDialog.jsx` |
| 頭像外觀 | `src/components/Avatar.jsx` |
| 錯誤畫面 | `src/components/RenderErrorBoundary.jsx` |
| Firebase 設定 | `src/config/firebase.js` |
| **牌桌版面（A～F 區：頂列、動態、月亮／牌庫、玩家列、戰場、手牌）的排版、文字、顏色** | **`src/components/GameBoard.jsx`** |
| 遊戲邏輯、彈窗（勝利、規則、紀錄）、大廳畫面 | `src/App.jsx` |

## 還沒拆的部分（刻意保留）

1. **`App.jsx` 裡的 `function App()`**（約 3,800 行）：遊戲邏輯、大廳畫面與各種彈窗仍在這裡，硬拆容易改壞規則，所以原樣保留。牌桌 A～F 區的畫面已搬到 `components/GameBoard.jsx`，`App` 以 props 把狀態與函式傳進去。
2. **`finale.jsx` 與 `cards.jsx` 內寫在 JSX / 行內 style 的顏色和中文**（例如「狼月降臨」「吸血鬼降臨」）。

## 換整體顏色（Tailwind）

你的 `index.html` 使用 Tailwind CDN，所以我加了 **`public/tailwind-theme.js`**，並在 `index.html` 裡、CDN 腳本之後載入它。
裡面有 `slate`（底色）、`amber`（金色強調）、`emerald`（綠）、`rose`（紅）四組色盤，目前填的是預設值（不改就和原本一樣）。
想換整個介面的顏色，只要改這個檔案的色階就好，不用動 App.jsx 裡的 755 處 class。

動畫發光色（`styles/theme.css`）是另一份，若要跟著換請同步修改。

## 這次改了什麼

- 牌桌 A～F 區畫面（542 行）搬到 `components/GameBoard.jsx`；`App.jsx` 只留縮放外框與一個 `<GameBoard {...props} />`。
- 新增專案根目錄需要的 `package.json`、`vite.config.js`（`index.html` 與 `public/` 也在根目錄）。
- 所有 `window.xxx` 共用變數改成正式的 `import` / `export`，`cards.jsx` 與 `finale.jsx` 之間不再互相循環依賴。
- Firebase Analytics 原本是 `App` 直接改模組變數，改成 `setFirebaseAnalytics()`。
- 移除 `console.log('[cards] Vite module loaded')` 之類的除錯輸出。
- 新增 `public/tailwind-theme.js`，並在 `index.html` 加一行載入。
- 三個 CSS 檔裡寫死的顏色（39 處）改成引用 `theme.css` 的變數。
- `main.jsx` 改從 `components/RenderErrorBoundary.jsx` 引入錯誤邊界。

## 驗證與限制

已做：所有檔案可通過 esbuild 打包；沒有未宣告的變數（只剩 `firebase`，它是 `index.html` 載入的 CDN 全域變數，和原本一樣）；新檔案的程式碼與原檔逐行比對，只有上述預期差異。

**沒做：我這裡無法開瀏覽器執行遊戲。** 請在本機 `npm run dev` 後，實際玩一輪（開局、打幾張牌、看動畫、開規則視窗）確認沒問題。
