

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAb_sbf1K0MiXyNa-OodtvU1YKkJ_xloFw',
  authDomain: 'wolfmoon-8da67.firebaseapp.com',
  databaseURL: 'https://wolfmoon-8da67-default-rtdb.firebaseio.com',
  projectId: 'wolfmoon-8da67',
  storageBucket: 'wolfmoon-8da67.firebasestorage.app',
  messagingSenderId: '166316666956',
  appId: '1:166316666956:web:a3e4991950755fb85844e9',
  measurementId: 'G-VMB73VCQQQ',
};
let firebaseAnalytics = null;
// App 初始化 Firebase 後透過這個函式登記 Analytics 實例
export const setFirebaseAnalytics = (analytics) => { firebaseAnalytics = analytics; };
export const isFirebaseConfigured = () =>
  Object.values(FIREBASE_CONFIG).every(value =>
    typeof value === 'string' && value.trim() && !value.includes('YOUR_FIREBASE_')
  );
export const trackAnalyticsEvent = (name) => {
  if (typeof window.va === 'function') window.va('event', { name });
  if (firebaseAnalytics) {
    try {
      firebaseAnalytics.logEvent(name);
    } catch (error) {
      console.warn(`Firebase Analytics event "${name}" failed:`, error);
    }
  }
};
