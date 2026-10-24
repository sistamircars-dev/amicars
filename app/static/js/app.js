import { startArchiveVault } from "./archiveVault.js?v=49";
import { startRuntime } from "./pwa.js?v=49";
import { startSyncEngine } from "./syncEngine.js?v=49";
import { startRouter } from "./router.js?v=49";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
