import { startArchiveVault } from "./archiveVault.js?v=50";
import { startRuntime } from "./pwa.js?v=50";
import { startSyncEngine } from "./syncEngine.js?v=50";
import { startRouter } from "./router.js?v=50";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
