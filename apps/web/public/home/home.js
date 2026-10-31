// Points the download buttons at the right installer for the visitor's computer. Without
// JavaScript they keep their plain link to the latest release page. Nothing is stored or sent.
(function () {
  var base = 'https://github.com/ColbyGallagher/redcolumn/releases/latest/download/';
  var uaData = navigator.userAgentData;
  var platform = ((uaData && uaData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
  var target = null;
  if (/win/.test(platform)) target = { label: 'Download for Windows', href: base + 'redcolumn-Setup.exe' };
  else if (/mac/.test(platform)) target = { label: 'Download for macOS', href: base + 'redcolumn-arm64.dmg', alt: [['Intel Mac', 'redcolumn-x64.dmg']] };
  else if (/linux|x11/.test(platform) && !/android/.test(navigator.userAgent.toLowerCase())) target = { label: 'Download for Linux', href: base + 'redcolumn-x86_64.AppImage' };
  if (!target) return;

  var buttons = document.querySelectorAll('#download, [data-download]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].textContent = target.label;
    buttons[i].href = target.href;
  }

  var note = document.getElementById('download-note');
  if (note) {
    var links = [];
    if (target.alt) {
      for (var j = 0; j < target.alt.length; j++) links.push('<a href="' + base + target.alt[j][1] + '">' + target.alt[j][0] + '</a>');
    }
    links.push('<a href="https://github.com/ColbyGallagher/redcolumn/releases/latest">All downloads</a>');
    note.innerHTML = links.join(' · ');
  }
})();

// Demo clips play while they are on screen and pause when they are not. With reduced motion
// they stay on their poster frame and get controls, so nothing moves unless asked.
function clips() {
  var videos = document.querySelectorAll('.clip video');
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || !('IntersectionObserver' in window)) {
    for (var i = 0; i < videos.length; i++) videos[i].controls = true;
    return;
  }
  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.preload = 'auto';
        var p = e.target.play();
        if (p && p.catch) p.catch(function (err) { if (err && err.name === 'NotAllowedError') e.target.controls = true; });
      } else {
        e.target.pause();
      }
    });
  }, { threshold: 0.35 });
  for (var j = 0; j < videos.length; j++) seen.observe(videos[j]);
}
clips();
