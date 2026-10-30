import { fetchBcvDate, fetchBcvToday } from "./api.js";
import { raiseSalePrices } from "./catalog.js";
import { archiveStatus, restoreHistoryFromFile, runArchiveIfNeeded } from "./archiveVault.js?v=52";
import { createDateField } from "./dateField.js?v=34";
import { pickArchiveDir } from "./diskStore.js?v=52";
import { h } from "./dom.js";
import { countBackupRows, downloadBackup, exportLocalBackup, restoreLocalBackup } from "./localBackup.js";
import { formatDisplayDate, formatRate } from "./movements.js";
import { downloadClientScript, runInstallSetup } from "./pwa.js?v=52";
import { getConfig, getTasa, setConfig, upsertTasa } from "./store.js";
import { collectPhotoIndex, downloadPhotoIndex, importPhotoSource } from "./photoIndex.js";
import { publishPhotosFromThisDevice, pullPublishedPhotos, runSync } from "./syncEngine.js";

export async function refreshRateChip() {
  const chip = document.getElementById("rate-chip");
  if (!chip) {
    return;
  }
  const tasa = await getTasa();
  if (!tasa) {
    chip.textContent = "Tasa BCV: —";
    return;
  }
  chip.textContent = `Tasa BCV ${formatDisplayDate(tasa.fecha)}: ${formatRate(tasa.usd_ves)} Bs/USD`;
}

export async function syncTodayRate() {
  try {
    const result = await fetchBcvToday();
    if (!result.ok || !result.data || !result.data.ok) {
      return;
    }
    await upsertTasa(result.data);
    await refreshRateChip();
  } catch (_err) {
    /* La barra conserva la última tasa guardada. */
  }
}

export async function ensureRateForDate(fecha) {
  const wanted = String(fecha || "").slice(0, 10);
  if (!wanted) {
    return getTasa();
  }
  const local = await getTasa(wanted);
  if (local) {
    return local;
  }
  try {
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const result = wanted === isoToday ? await fetchBcvToday() : await fetchBcvDate(wanted);
    if (result.ok && result.data && result.data.ok) {
      await upsertTasa(result.data);
      await refreshRateChip();
    }
  } catch (_err) {
    /* Se usa la tasa local más cercana. */
  }
  return (await getTasa(wanted)) || (await getTasa());
}

async function applyRemote(result, statusNode) {
  if (!result.ok || !result.data || !result.data.ok) {
    statusNode.textContent = (result.data && result.data.error) || "No se pudo consultar la tasa.";
    return;
  }
  await upsertTasa(result.data);
  await refreshRateChip();
  statusNode.textContent = `Tasa ${formatDisplayDate(result.data.fecha)}: ${formatRate(result.data.usd_ves)} Bs por USD (${result.data.fuente}).`;
}

export async function renderConfig(root) {
  const status = h("p", { class: "muted" }, "Consultando…");
  const dateInput = createDateField({ ariaLabel: "Fecha de la tasa BCV" });
  const stockInput = h("input", {
    class: "app-input",
    type: "number",
    min: "0",
    step: "1",
    value: "1",
  });
  const current = await getConfig("stock_minimo_global", { cantidad: 1 });
  if (current && current.cantidad !== undefined) {
    stockInput.value = String(current.cantidad);
  }

  const todayBtn = h("button", { class: "btn", type: "button" }, "Tasa del día");
  todayBtn.addEventListener("click", async () => {
    status.textContent = "Consultando tasa del día…";
    await applyRemote(await fetchBcvToday(), status);
  });

  const dateBtn = h("button", { class: "btn ghost", type: "button" }, "Buscar por fecha");
  dateBtn.addEventListener("click", async () => {
    if (!dateInput.value) {
      status.textContent = "Seleccione una fecha.";
      return;
    }
    status.textContent = `Buscando tasa del ${formatDisplayDate(dateInput.value)}…`;
    const local = await getTasa(dateInput.value);
    if (local) {
      status.textContent = `Tasa local ${formatDisplayDate(local.fecha)}: ${formatRate(local.usd_ves)} Bs/USD.`;
    }
    await applyRemote(await fetchBcvDate(dateInput.value), status);
  });

  const saveStock = h("button", { class: "btn", type: "button" }, "Guardar stock mínimo global");
  saveStock.addEventListener("click", async () => {
    const cantidad = Number(stockInput.value || 0);
    await setConfig("stock_minimo_global", { cantidad });
    status.textContent = `Stock mínimo global: ${cantidad}.`;
  });

  const percentInput = h("input", {
    class: "app-input",
    type: "number",
    step: "0.01",
    placeholder: "Ej. 10 para +10%",
    "aria-label": "Porcentaje de aumento",
  });
  const priceStatus = h("p", { class: "muted" }, "");
  const raiseBtn = h("button", { class: "btn", type: "button" }, "Aplicar aumento");
  raiseBtn.addEventListener("click", async () => {
    const percent = Number(percentInput.value);
    if (!Number.isFinite(percent) || percent === 0) {
      priceStatus.textContent = "Indique el porcentaje (puede ser negativo para bajar).";
      return;
    }
    const ok = window.confirm(`¿Subir todos los precios de venta un ${percent}%?`);
    if (!ok) {
      return;
    }
    raiseBtn.disabled = true;
    try {
      const count = await raiseSalePrices(percent);
      priceStatus.textContent = `Se actualizaron ${count} productos.`;
      await runSync(true);
    } catch (err) {
      priceStatus.textContent = err.message || "No se pudieron actualizar los precios.";
    } finally {
      raiseBtn.disabled = false;
    }
  });

  const backupStatus = h(
    "p",
    { class: "muted", id: "backup-status" },
    "Puede guardar o restaurar el archivo de respaldo."
  );
  const saveBackup = h(
    "button",
    { class: "btn", type: "button", id: "save-local-backup" },
    "Guardar respaldo en este equipo"
  );
  const restoreBtn = h(
    "button",
    { class: "btn ghost", type: "button", id: "restore-local-backup" },
    "Restaurar respaldo"
  );
  const fileInput = h("input", {
    id: "restore-local-file",
    type: "file",
    accept: "application/json,.json",
    hidden: "hidden",
  });

  saveBackup.addEventListener("click", async () => {
    saveBackup.disabled = true;
    try {
      const payload = await exportLocalBackup();
      downloadBackup(payload);
      backupStatus.textContent = `Respaldo guardado en este equipo (${countBackupRows(payload)} registros).`;
    } catch (err) {
      backupStatus.textContent = (err && err.message) || "No se pudo guardar el respaldo.";
    } finally {
      saveBackup.disabled = false;
    }
  });

  restoreBtn.addEventListener("click", () => {
    fileInput.click();
  });

  const photoStatus = h(
    "p",
    { class: "muted" },
    "La sync de catálogo no trae los archivos de la otra PC. Hay que publicar el índice de fotos desde el equipo donde se cargaron."
  );
  const publishPhotosBtn = h("button", { class: "btn", type: "button" }, "Publicar fotos de ESTE equipo");
  const pullPhotosBtn = h("button", { class: "btn ghost", type: "button" }, "Buscar fotos ya publicadas");
  const downloadPhotosBtn = h("button", { class: "btn ghost", type: "button" }, "Descargar índice de fotos");
  const importPhotosBtn = h("button", { class: "btn ghost", type: "button" }, "Importar índice o respaldo");
  const photoInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: "hidden",
  });

  publishPhotosBtn.addEventListener("click", async () => {
    publishPhotosBtn.disabled = true;
    photoStatus.textContent = "Publicando fotos de este equipo a la nube…";
    try {
      const result = await publishPhotosFromThisDevice();
      photoStatus.textContent =
        result.local < 1
          ? "En este equipo no hay fotos locales para publicar. Use este botón en la PC donde se cargaron las imágenes."
          : `Publicadas ${result.upserted} de ${result.local} fotos. En la otra PC pulse “Buscar fotos ya publicadas”.`;
    } catch (err) {
      photoStatus.textContent = (err && err.message) || "No se pudieron publicar las fotos.";
    } finally {
      publishPhotosBtn.disabled = false;
    }
  });

  pullPhotosBtn.addEventListener("click", async () => {
    pullPhotosBtn.disabled = true;
    photoStatus.textContent = "Buscando fotos publicadas…";
    try {
      const result = await pullPublishedPhotos();
      photoStatus.textContent =
        result.applied > 0
          ? `Se trajeron ${result.applied} fotos. Recargue inventario si no las ve aún.`
          : "La nube aún no tiene el índice. Ábralo en la PC donde están las fotos y pulse “Publicar fotos de ESTE equipo”.";
    } catch (err) {
      photoStatus.textContent = (err && err.message) || "No se pudieron traer las fotos.";
    } finally {
      pullPhotosBtn.disabled = false;
    }
  });

  downloadPhotosBtn.addEventListener("click", async () => {
    downloadPhotosBtn.disabled = true;
    try {
      const items = await collectPhotoIndex();
      if (!items.length) {
        photoStatus.textContent = "En este equipo no hay un índice de fotos para descargar.";
        return;
      }
      downloadPhotoIndex(items);
      photoStatus.textContent = `Índice descargado (${items.length} fotos). Ábralo en Configuración de la otra PC.`;
    } catch (err) {
      photoStatus.textContent = (err && err.message) || "No se pudo descargar el índice.";
    } finally {
      downloadPhotosBtn.disabled = false;
    }
  });

  importPhotosBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = "";
    if (!file) {
      return;
    }
    importPhotosBtn.disabled = true;
    photoStatus.textContent = "Importando fotos…";
    try {
      const summary = await importPhotoSource(await file.text());
      await runSync(true);
      photoStatus.textContent = `Importadas ${summary.applied} fotos${summary.queued ? ` y ${summary.queued} en cola local` : ""}.`;
    } catch (err) {
      photoStatus.textContent = (err && err.message) || "No se pudo importar el archivo.";
    } finally {
      importPhotosBtn.disabled = false;
    }
  });

  const memoryStatus = h("p", { class: "muted" }, "Calculando memoria local…");
  const folderBtn = h("button", { class: "btn", type: "button" }, "Elegir carpeta de archivo");
  const archiveNow = h("button", { class: "btn ghost", type: "button" }, "Archivar histórico ahora");
  const restoreHistBtn = h("button", { class: "btn ghost", type: "button" }, "Traer histórico del disco");
  const histInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: "hidden",
    multiple: "multiple",
  });
  const installBtn = h("button", { class: "btn", type: "button" }, "Instalar en este equipo");
  const scriptBtn = h("button", { class: "btn ghost", type: "button" }, "Descargar acceso .cmd");

  async function refreshMemory() {
    try {
      const status = await archiveStatus();
      const pct = Math.round(status.memory.ratio * 100);
      const folder = status.hasFolder ? "Carpeta de archivo lista." : "Aún no hay carpeta; se descargará el histórico.";
      memoryStatus.textContent = `Memoria de páginas virtuales: ${pct}%. Pendiente de purgar en la nube: ${status.pending}. ${folder}`;
    } catch (_err) {
      memoryStatus.textContent = "No se pudo leer el uso de memoria local.";
    }
  }

  folderBtn.addEventListener("click", async () => {
    try {
      await pickArchiveDir();
      memoryStatus.textContent = "Carpeta de archivo guardada en este equipo.";
      await refreshMemory();
    } catch (err) {
      memoryStatus.textContent = (err && err.message) || "No se eligió carpeta.";
    }
  });

  archiveNow.addEventListener("click", async () => {
    archiveNow.disabled = true;
    try {
      const result = await runArchiveIfNeeded({ force: true, interactive: true });
      if (result && result.empty) {
        memoryStatus.textContent = "No hay histórico viejo o en desuso para archivar.";
      } else if (result && result.ok) {
        memoryStatus.textContent = `Archivados ${result.total} registros en este PC. La nube se limpia al haber conexión.`;
      } else {
        memoryStatus.textContent = "La memoria aún no llega al 90 % y no se forzó vacío.";
      }
      await refreshMemory();
    } catch (err) {
      memoryStatus.textContent = (err && err.message) || "No se pudo archivar.";
    } finally {
      archiveNow.disabled = false;
    }
  });

  restoreHistBtn.addEventListener("click", () => histInput.click());
  histInput.addEventListener("change", async () => {
    const files = [...(histInput.files || [])];
    histInput.value = "";
    if (!files.length) {
      return;
    }
    restoreHistBtn.disabled = true;
    try {
      let rows = 0;
      for (const file of files) {
        const summary = await restoreHistoryFromFile(file);
        rows += summary.rows;
      }
      memoryStatus.textContent = `Histórico recuperado del disco (${rows} registros). No se vuelve a subir a la nube.`;
    } catch (err) {
      memoryStatus.textContent = (err && err.message) || "No se pudo leer el histórico.";
    } finally {
      restoreHistBtn.disabled = false;
    }
  });

  installBtn.addEventListener("click", async () => {
    await runInstallSetup();
    downloadClientScript();
    memoryStatus.textContent = "App lista en este equipo: sin Node ni Python. Si no hay internet, se abre y guarda en local.";
  });
  scriptBtn.addEventListener("click", () => {
    downloadClientScript();
  });

  refreshMemory();

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) {
      return;
    }
    const confirmed = window.confirm(
      "Esto reemplaza las tablas locales de este equipo. Los datos en la nube no se borran. ¿Continuar?"
    );
    if (!confirmed) {
      return;
    }
    restoreBtn.disabled = true;
    try {
      const summary = await restoreLocalBackup(await file.text());
      backupStatus.textContent = `Respaldo restaurado (${summary.rows} registros). La sincronización con la nube sigue activa.`;
      await refreshRateChip();
      await runSync(true);
    } catch (err) {
      backupStatus.textContent = (err && err.message) || "No se pudo restaurar el respaldo.";
    } finally {
      restoreBtn.disabled = false;
    }
  });

  await applyRemote(await fetchBcvToday(), status);

  root.replaceChildren(
    h("div", { class: "view-title" }, h("h2", {}, "Configuración y tasa BCV")),
    h(
      "div",
      { class: "grid-2" },
      h(
        "section",
        { class: "glass cat-card" },
        h("h3", {}, "Tasa BCV"),
        dateInput,
        h("div", { class: "acc-actions" }, todayBtn, dateBtn),
        status
      ),
      h(
        "section",
        { class: "glass cat-card" },
        h("h3", {}, "Stock mínimo global"),
        h("p", { class: "muted" }, "Se usa cuando el producto no tiene un mínimo propio."),
        stockInput,
        saveStock
      )
    ),
    h(
      "section",
      { class: "glass cat-card", style: "margin-top:0.9rem" },
      h("h3", {}, "Subir precios lineales por porcentaje"),
      h("p", { class: "muted" }, "Aplica el porcentaje a todos los precios de venta REF del catálogo y deja el cambio en el histórico."),
      percentInput,
      h("div", { class: "acc-actions" }, raiseBtn),
      priceStatus
    ),
    h(
      "section",
      { class: "glass cat-card", style: "margin-top:0.9rem" },
      h("h3", {}, "Fotos entre equipos"),
      h(
        "p",
        { class: "muted" },
        "Los archivos originales quedan en el navegador de la PC donde se cargaron. En ESA computadora pulse “Publicar fotos de ESTE equipo”. En esta, pulse “Buscar fotos ya publicadas”. Si no hay red entre las dos, descargue el índice allá e impórtelo aquí."
      ),
      h("div", { class: "acc-actions" }, publishPhotosBtn, pullPhotosBtn, downloadPhotosBtn, importPhotosBtn),
      photoInput,
      photoStatus
    ),
    h(
      "section",
      { class: "glass cat-card", style: "margin-top:0.9rem" },
      h("h3", {}, "Respaldo en este equipo"),
      h(
        "p",
        { class: "muted" },
        "Descarga las tablas locales en este equipo. Restaurar reemplaza IndexedDB de este navegador y no borra la base en Supabase."
      ),
      h("div", { class: "acc-actions" }, saveBackup, restoreBtn),
      fileInput,
      backupStatus
    ),
    h(
      "section",
      { class: "glass cat-card", style: "margin-top:0.9rem" },
      h("h3", {}, "Archivo al 90 % y purga en la nube"),
      h(
        "p",
        { class: "muted" },
        "Si las páginas virtuales superan el 90 %, el histórico viejo (facturas primeras, imágenes en desuso, bitácora antigua) se guarda en el disco de esta PC y se borra de Supabase y Cloudinary. El catálogo y el stock actual se quedan."
      ),
      h("div", { class: "acc-actions" }, folderBtn, archiveNow, restoreHistBtn),
      histInput,
      memoryStatus
    ),
    h(
      "section",
      { class: "glass cat-card", style: "margin-top:0.9rem" },
      h("h3", {}, "Instalar en otra PC"),
      h(
        "p",
        { class: "muted" },
        "No hace falta Node. Instale desde el navegador; al reconectar se traen módulos nuevos o el apagado del servicio. Sin internet la app se abre sola y guarda en local."
      ),
      h("div", { class: "acc-actions" }, installBtn, scriptBtn)
    )
  );
}
