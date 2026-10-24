export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registration;
  } catch (_err) {
    return null;
  }
}
