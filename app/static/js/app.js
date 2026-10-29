import { startArchiveVault } from "./archiveVault.js?v=52";
import { startRuntime } from "./pwa.js?v=52";
import { startSyncEngine } from "./syncEngine.js?v=52";
import { startRouter } from "./router.js?v=52";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
