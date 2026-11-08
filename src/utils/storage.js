

// 沙盒／隱私模式可能無法存取 localStorage
export const safeStorageGet = (key) => {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
};
export const safeStorageSet = (key, value) => {
  try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
};
