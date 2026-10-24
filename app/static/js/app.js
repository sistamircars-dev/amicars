import { registerServiceWorker } from "./pwa.js";
import { startSyncEngine } from "./syncEngine.js";
import { startRouter } from "./router.js";
import { refreshRateChip, syncTodayRate } from "./bcvView.js";

registerServiceWorker();
startSyncEngine();
startRouter();
refreshRateChip();
syncTodayRate();
