import { startArchiveVault } from "./archiveVault.js?v=48";
import { startRuntime } from "./pwa.js?v=48";
import { startSyncEngine } from "./syncEngine.js?v=48";
import { startRouter } from "./router.js?v=48";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
