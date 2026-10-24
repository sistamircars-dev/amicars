import { startArchiveVault } from "./archiveVault.js?v=47";
import { startRuntime } from "./pwa.js?v=47";
import { startSyncEngine } from "./syncEngine.js?v=47";
import { startRouter } from "./router.js?v=47";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
