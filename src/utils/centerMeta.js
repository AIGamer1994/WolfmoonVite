

// 每一格中央暗牌的追蹤資料：誰看過、誰換過、玩家自己看過的內容（myStale = 之後有人動過）
export const makeCenterMeta = () => ({ viewedBy: [], swappedBy: [], knownBy: {}, myCard: null, myCardOwnerId: null, myStale: false });
export const centerKnowledge = meta => {
  const knownBy = { ...(meta && meta.knownBy || {}) };
  if (meta && meta.myCard && meta.myCardOwnerId !== null && meta.myCardOwnerId !== undefined && !knownBy[meta.myCardOwnerId]) {
    knownBy[meta.myCardOwnerId] = { card: meta.myCard, stale: !!meta.myStale };
  }
  return knownBy;
};
