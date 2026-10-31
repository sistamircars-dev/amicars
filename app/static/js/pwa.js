import { healthCheck, runtimeInfo } from "./api.js";

const REVISION_KEY = "jdparfum-revision";
let deferredInstall = null;
let reloading = false;

function currentRevision() {
  return window.localStorage.getItem(REVISION_KEY) || "";
}

function rememberRevision(revision) {
  if (revision) {
    window.localStorage.setItem(REVISION_KEY, revision);
  }
}

async function persistStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      await navigator.storage.persist();
    } catch (_err) {
      /* El navegador decide si concede persistencia. */
    }
  }
}

function reloadOnce() {
  if (reloading) {
    return;
  }
  reloading = true;
  window.location.reload();
}

async function waitForWorker(worker) {
  if (!worker) {
    return;
  }
  return new Promise((resolve) => {
    if (worker.state === "installed" || worker.state === "activated") {
      resolve();
      return;
    }
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" || worker.state === "activated") {
        resolve();
      }
    });
  });
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) {
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
    return registration;
  } catch (_err) {
    return null;
  }
}

export async function applyRemoteRevision() {
  if (!navigator.onLine) {
    return { changed: false, offline: true };
  }
  const info = await runtimeInfo();
  if (!info || !info.revision) {
    return { changed: false };
  }
  const previous = currentRevision();
  if (previous && previous !== info.revision) {
    rememberRevision(info.revision);
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        await waitForWorker(registration.installing || registration.waiting);
      }
    }
    reloadOnce();
    return { changed: true, revision: info.revision };
  }
  rememberRevision(info.revision);
  return { changed: false, revision: info.revision };
}

export async function refreshServiceWorker() {
  if (!("serviceWorker" in navigator) || !navigator.onLine) {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    return registerServiceWorker();
  }
  await registration.update();
  if (registration.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
  return registration;
}

export function downloadClientScript() {
  const link = document.createElement("a");
  link.href = `${window.location.origin}/install/jdparfum-pc.cmd`;
  link.download = "jdparfum-acceso.cmd";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function consumeInstallPrompt() {
  const event = deferredInstall;
  deferredInstall = null;
  return event;
}

export async function runInstallSetup() {
  await persistStorage();
  await registerServiceWorker();
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
  }
  return true;
}

export function startRuntime() {
  registerServiceWorker();
  persistStorage();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
  });
  window.addEventListener("appinstalled", () => {
    persistStorage();
    downloadClientScript();
  });
  window.addEventListener("online", () => {
    const loaded = Number(window.sessionStorage.getItem("jdparfum-loaded") || "0");
    if (loaded && Date.now() - loaded > 6 * 60 * 60 * 1000) {
      window.sessionStorage.setItem("jdparfum-loaded", String(Date.now()));
      reloadOnce();
      return;
    }
    refreshServiceWorker();
    applyRemoteRevision();
    healthCheck();
  });
  if (!window.sessionStorage.getItem("jdparfum-loaded")) {
    window.sessionStorage.setItem("jdparfum-loaded", String(Date.now()));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      refreshServiceWorker();
      applyRemoteRevision();
    }
  });
  if (navigator.onLine) {
    applyRemoteRevision();
  }
}
