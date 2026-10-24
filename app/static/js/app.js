import { startArchiveVault } from "./archiveVault.js?v=46";
import { startRuntime } from "./pwa.js?v=46";
import { startSyncEngine } from "./syncEngine.js?v=46";
import { startRouter } from "./router.js?v=46";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
