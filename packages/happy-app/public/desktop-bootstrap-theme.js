(function () {
  try {
    var rawSettings = window.localStorage.getItem('mmkv.default\\local-settings');
    if (!rawSettings) return;
    var preference = JSON.parse(rawSettings).themePreference;
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-happy-bootstrap-theme', preference);
    }
  } catch (_) {
    // The CSS media query remains the safe fallback when storage is unavailable.
  }
})();
