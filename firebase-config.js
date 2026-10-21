export const firebaseConfig = {
  apiKey: "AIzaSyD8jJjI_5NzJ1m2lS6Bqg73odO6s0oElsY",
  authDomain: "auan-da695.firebaseapp.com",
  projectId: "auan-da695",
  storageBucket: "auan-da695.firebasestorage.app",
  messagingSenderId: "952091703599",
  appId: "1:952091703599:web:13326c49ee242ac0f3c9da",
  measurementId: "G-ZY42X4JQFM"
};

// Push notifications: put the URL of your Cloudflare Worker here (see worker.js).
// The VAPID *public* key below is safe to publish. The private key goes ONLY into the Worker's secrets.
export const pushConfig = {
  workerUrl: "",   // e.g. "https://auan-push.YOURNAME.workers.dev"
  vapidPublicKey: "BEvyb5Zp8qR66wC3faLgE7ws-LbFK3RJgJtvtNbutrKTWKyyk2FQEG6rGQjjeiIsFEGwCeRNAm-C7LwCTJxLvYA"
};
