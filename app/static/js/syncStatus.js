const LABELS = {
  synced: "Sincronizado",
  syncing: "Sincronizando…",
  offline: "Modo Offline",
  retry: "Reintentar Sincronización",
  unknown: "Iniciando…",
};

export function setSyncStatus(state, extra = "") {
  const root = document.getElementById("sync-indicator");
  if (!root) {
    return;
  }
  root.dataset.state = state;
  const label = root.querySelector(".sync-label");
  let text = LABELS[state] || LABELS.unknown;
  if (state === "offline" && extra) {
    text = `Modo Offline (${extra} cambios guardados localmente)`;
  }
  if (label) {
    label.textContent = text;
  }
  const icon = root.querySelector(".sync-icon");
  if (icon) {
    icon.textContent =
      state === "synced" ? "🟢" : state === "syncing" ? "🔄" : state === "retry" ? "🔴" : "🟠";
  }
}

export function bindRetry(handler) {
  const root = document.getElementById("sync-indicator");
  if (!root) {
    return;
  }
  root.addEventListener("click", () => {
    if (root.dataset.state === "retry" || root.dataset.state === "offline") {
      handler();
    }
  });
}
