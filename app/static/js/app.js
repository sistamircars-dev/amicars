import { startArchiveVault } from "./archiveVault.js?v=45";
import { startRuntime } from "./pwa.js?v=45";
import { startSyncEngine } from "./syncEngine.js?v=45";
import { startRouter } from "./router.js?v=45";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
