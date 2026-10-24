import { db } from "./db.js";
import { h } from "./dom.js";
import { getPrefs, savePrefs } from "./store.js";

export async function mountFieldFilters(host, { scope, onChange }) {
  const campos = await db.campos_personalizados.filter((row) => row.is_active !== false).toArray();
  const names = [...new Set(campos.map((row) => row.nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const prefs = await getPrefs();
  const stored = (prefs.filtros && prefs.filtros[scope]) || { active: [], values: {} };
  const active = new Set(stored.active || []);
  const values = { ...(stored.values || {}) };
  const checks = h("div", { class: "filter-checks" });
  const inputs = h("div", { class: "filter-inputs" });

  async function publish() {
    const latest = await getPrefs();
    const filtros = { ...(latest.filtros || {}) };
    filtros[scope] = { active: [...active], values: { ...values } };
    await savePrefs({ filtros });
    onChange({ active: [...active], values: { ...values } });
  }

  function drawInputs() {
    inputs.replaceChildren(
      ...[...active].map((name) => {
        const field = h("input", {
          class: "app-input",
          type: "search",
          value: values[name] || "",
          placeholder: name,
          "aria-label": `Filtro ${name}`,
        });
        field.addEventListener("input", () => {
          values[name] = field.value;
          publish();
        });
        return h("label", { class: "field-row filter-field" }, h("span", {}, name), field);
      })
    );
  }

  names.forEach((name) => {
    const box = h("input", { type: "checkbox" });
    box.checked = active.has(name);
    box.addEventListener("change", () => {
      if (box.checked) {
        active.add(name);
      } else {
        active.delete(name);
      }
      drawInputs();
      publish();
    });
    checks.append(h("label", { class: "check" }, box, name));
  });

  host.replaceChildren(
    h("details", { class: "filter-box" }, h("summary", {}, "Filtros por campos"), names.length ? checks : h("p", { class: "muted" }, "Cree campos en Categorías para filtrar."), inputs)
  );
  drawInputs();
  await onChange({ active: [...active], values: { ...values } });
}
