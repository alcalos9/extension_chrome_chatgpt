// El panel lateral (no el popup) aloja toda la lógica: no se cierra al perder el foco,
// así que la exportación no se interrumpe si el usuario hace clic en otra parte.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('No se pudo configurar el panel lateral', err));
