export function registerPwa(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  const register = (): void => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('[pwa] Service worker registration failed:', error);
    });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
