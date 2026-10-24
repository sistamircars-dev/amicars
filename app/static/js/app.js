import { startArchiveVault } from "./archiveVault.js?v=51";
import { startRuntime } from "./pwa.js?v=51";
import { startSyncEngine } from "./syncEngine.js?v=51";
import { startRouter } from "./router.js?v=51";
import { refreshRateChip, syncTodayRate } from "./bcvView.js?v=35";

startRuntime();
startSyncEngine();
startRouter();
startArchiveVault();
refreshRateChip();
syncTodayRate();
