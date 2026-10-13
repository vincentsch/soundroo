// Applies the saved theme before the first paint. A classic script so it runs
// synchronously in <head>; the studio's CSP allows only same-origin scripts.
try {
  const saved = JSON.parse(localStorage.getItem('soundroo.settings.v1') || '{}');
  const dark = saved.theme === 'dark' || (saved.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (saved.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.dataset.motion = 'reduce';
} catch {
  // Storage can be unavailable; the app applies defaults when it starts.
}
