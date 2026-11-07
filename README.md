# 狼月 Wolf Moon（Vite 版）

由原本的三檔（`index.html` + `cards.js` + `finale.js` + Babel Standalone）遷移為 Vite + React 模組。

## 本機啟動

```bash
cd wolf-moon
npm install
npm run dev
```

瀏覽器打開終端機顯示的網址（預設 http://localhost:5173）。

**不要**直接雙擊 `index.html`（需要開發伺服器）。

## 建置與部署

```bash
npm run build      # 產出 dist/
npm run preview    # 本機預覽建置結果
```

把 `dist/` 上傳到 Vercel / Netlify / 任意靜態空間即可。

## 目錄結構

```
wolf-moon/
  index.html       # Vite 入口（薄頁面）
  package.json
  vite.config.js
  src/
    main.jsx       # React 掛載
    App.jsx        # 主程式／遊戲邏輯（原 index.html Babel 區塊）
    cards.jsx      # 牌面與效果動畫（原 cards.js）
    cards.css
    finale.jsx     # 終局動畫（原 finale.js）
    finale.css
    index.css      # 全域樣式
```

## 與舊版差異

- 瀏覽器不再現場編譯 JSX（較快、較穩）
- `cards` / `finale` 改為正式 JSX 模組，不再字串 + eval
- 開發用 `npm run dev`，上線用 `dist/`
- Firebase / Tailwind / FontAwesome 仍用 CDN（與舊版相同）

舊的三個靜態檔可保留當對照，不影響本專案。
