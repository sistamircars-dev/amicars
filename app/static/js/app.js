import { startArchiveVault } from "./archiveVault.js?v=54";
import { startRuntime } from "./pwa.js?v=52";
import { startSyncEngine } from "./syncEngine.js?v=59";
import { startRouter } from "./router.js?v=55";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=53";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
