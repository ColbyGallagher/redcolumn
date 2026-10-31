// Sets the colour theme before the first paint, so a light or graphite choice never flashes navy.
// Mirrors src/theme/themes.ts (src/theme/theme.test.ts keeps the two in step); theme.ts takes over once the app loads.
(function () {
  var themes = { navy: '#15213a', graphite: '#1c1c1f', light: '#e8edf5' };
  var choice = 'system';
  try {
    choice = JSON.parse(localStorage.getItem('nb.settings') || '{}').theme || 'system';
  } catch (e) {}
  var id = themes[choice] ? choice : window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'navy';
  document.documentElement.setAttribute('data-theme', id);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themes[id]);
})();
