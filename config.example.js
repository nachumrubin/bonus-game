// Copy this file to config.js and fill in the values.
// config.js is gitignored — never commit it.
window.APP_CONFIG = {
  onesignalAppId: '',   // OneSignal dashboard → Settings → Keys & IDs → App ID
  // URL of the deployed Cloudflare push worker (see /worker). The worker
  // holds the OneSignal REST API key as a secret so it never reaches the
  // browser. Without this set, push notifications are silently disabled.
  // Example: 'https://bonus-game-push.your-account.workers.dev'
  pushWorkerUrl: '',
  // Path (or remote URL) to the background music file. Without this the music
  // toggle is a UI-only flip — audioService no-ops when no source is present.
  // musicUrl: 'assets/music/bg.mp3',
};
