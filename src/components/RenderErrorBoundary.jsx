import React from 'react';

export class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('遊戲畫面渲染失敗：', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="min-h-screen bg-slate-950 text-rose-200 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-lg font-black">遊戲畫面發生錯誤</h1>
          <p className="max-w-xl text-sm break-words">{String(this.state.error.message || this.state.error)}</p>
          <p className="text-xs text-slate-400">請重新載入頁面；若問題重現，請提供此錯誤訊息與出問題的牌名。</p>
          <button onClick={() => window.location.reload()} className="rounded-lg bg-rose-900/70 px-4 py-2 text-sm font-bold">重新載入</button>
        </div>
      );
    }
    return this.props.children;
  }
}
