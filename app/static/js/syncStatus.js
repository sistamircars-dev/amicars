const LABELS = {
  connected: "Conectado",
  syncing: "Sincronizando…",
  offline: "Offline",
  pending: "Pendiente de subir",
  retry: "Reintentar sincronización",
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
    text = `Offline (${extra} cambios guardados localmente)`;
  }
  if (state === "pending" && extra) {
    text = `${extra} cambio${extra === "1" ? "" : "s"} por subir`;
  }
  if (label) {
    label.textContent = text;
  }
  const icon = root.querySelector(".sync-icon");
  if (icon) {
    icon.textContent =
      state === "connected"
        ? "🟢"
        : state === "syncing"
          ? "🔄"
          : state === "offline"
            ? "🟠"
            : state === "pending"
              ? "🟡"
              : "🔴";
  }
}

export function bindRetry(handler) {
  const root = document.getElementById("sync-indicator");
  if (!root) {
    return;
  }
  root.addEventListener("click", () => {
    const state = root.dataset.state;
    if (state === "retry" || state === "offline" || state === "pending") {
      handler();
    }
  });
}
