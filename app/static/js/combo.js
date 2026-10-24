import { matchesQuery } from "./catalog.js";
import { h } from "./dom.js";

const openCombos = new Set();
let watching = false;

function watchCombos() {
  if (watching) {
    return;
  }
  watching = true;
  document.addEventListener("pointerdown", (event) => {
    for (const combo of [...openCombos]) {
      if (!combo.input.isConnected) {
        combo.destroy();
        continue;
      }
      if (combo.element.contains(event.target) || combo.list.contains(event.target)) {
        continue;
      }
      combo.close();
    }
  });
  const reposition = () => {
    for (const combo of openCombos) {
      if (!combo.list.hidden) {
        combo.place();
      }
    }
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  const observer = new MutationObserver(() => {
    for (const combo of [...openCombos]) {
      if (combo.input.isConnected) {
        combo.seen = true;
        continue;
      }
      if (combo.seen) {
        combo.destroy();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function createCombo({
  options = [],
  value = "",
  placeholder = "Buscar…",
  emptyLabel = "",
  ariaLabel = "",
  onChange,
  freeText = false,
  text = "",
  onText,
} = {}) {
  watchCombos();
  let choices = Array.isArray(options) ? options : [];
  let selected = value || "";
  let customText = freeText ? String(text || "") : "";
  let query = "";
  let filtering = false;
  let activeIndex = 0;
  let visible = [];
  let destroyed = false;

  const input = h("input", {
    class: "app-input combo-input",
    type: "text",
    placeholder,
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "false",
    "aria-autocomplete": "list",
    "aria-label": ariaLabel || placeholder,
  });
  const list = h("div", { class: "suggest-list glass combo-list", hidden: true, role: "listbox" });
  const element = h("div", { class: "combo" }, input);

  function paintInput() {
    if (!input.isConnected || (document.activeElement === input && filtering)) {
      return;
    }
    const found = choices.find((opt) => opt.value === selected);
    if (found) {
      input.value = found.label;
      return;
    }
    input.value = freeText ? customText : "";
  }

  function place() {
    const rect = input.getBoundingClientRect();
    const width = Math.max(rect.width, 200);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    list.style.width = `${width}px`;
    list.style.left = `${left}px`;
    const below = window.innerHeight - rect.bottom;
    if (below < 180 && rect.top > below) {
      list.style.top = "auto";
      list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      list.style.bottom = "auto";
      list.style.top = `${rect.bottom + 4}px`;
    }
  }

  function renderList() {
    const typed = filtering ? query.trim() : "";
    visible = [];
    if (emptyLabel && (!typed || matchesQuery(emptyLabel.toLowerCase(), typed))) {
      visible.push({ value: "", label: emptyLabel });
    }
    const matched = choices.filter((opt) => {
      if (!typed) {
        return true;
      }
      return matchesQuery(`${opt.label || ""} ${opt.search || ""}`.toLowerCase(), typed);
    });
    visible.push(...matched.slice(0, 80));
    const selectedIndex = visible.findIndex((opt) => opt.value === selected);
    activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    if (!visible.length) {
      list.replaceChildren(h("div", { class: "suggest-empty-note" }, "Sin coincidencias."));
      return;
    }
    const nodes = visible.map((opt, index) => {
      const row = h(
        "div",
        {
          class: index === activeIndex ? "suggest-row suggest-open combo-active" : "suggest-row suggest-open",
          role: "option",
          "data-combo-index": String(index),
        },
        opt.label
      );
      row.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        choose(opt.value);
      });
      return row;
    });
    if (matched.length > 80) {
      nodes.push(h("div", { class: "suggest-empty-note" }, "Siga escribiendo para ver más."));
    }
    list.replaceChildren(...nodes);
  }

  function open() {
    if (destroyed || !input.isConnected) {
      return;
    }
    renderList();
    if (!list.isConnected) {
      document.body.append(list);
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    place();
  }

  function close(commit = true) {
    const wasFiltering = filtering;
    const typed = input.value;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    filtering = false;
    query = "";
    if (freeText && wasFiltering && commit) {
      customText = typed;
      const exact = choices.find((opt) => opt.value && String(opt.label || "").trim().toLowerCase() === typed.trim().toLowerCase());
      if (exact) {
        selected = exact.value;
        paintInput();
        if (onChange) {
          onChange(selected);
        }
        return;
      }
      selected = "";
      if (onText) {
        onText(customText);
      }
    }
    paintInput();
  }

  function choose(next) {
    selected = next || "";
    filtering = false;
    query = "";
    paintInput();
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    if (onChange) {
      onChange(selected);
    }
  }

  function move(delta) {
    if (list.hidden) {
      open();
    }
    if (!visible.length) {
      return;
    }
    activeIndex = (activeIndex + delta + visible.length) % visible.length;
    list.querySelectorAll("[data-combo-index]").forEach((node) => {
      node.classList.toggle("combo-active", Number(node.dataset.comboIndex) === activeIndex);
    });
    const current = list.querySelector(".combo-active");
    if (current && current.scrollIntoView) {
      current.scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("focus", () => {
    filtering = false;
    query = "";
    input.select();
    open();
  });
  input.addEventListener("pointerdown", () => {
    if (document.activeElement === input && list.hidden) {
      filtering = false;
      query = "";
      open();
    }
  });
  input.addEventListener("input", () => {
    filtering = true;
    query = input.value;
    if (freeText) {
      customText = input.value;
      selected = "";
      if (onText) {
        onText(customText);
      }
    } else if (!query.trim()) {
      selected = "";
      if (onChange) {
        onChange("");
      }
    }
    open();
  });
  input.addEventListener("blur", () => {
    if (!freeText) {
      return;
    }
    setTimeout(() => {
      if (destroyed || !input.isConnected || !filtering) {
        return;
      }
      close(true);
    }, 160);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = visible[activeIndex];
      if (item) {
        choose(item.value);
      } else if (freeText) {
        close(true);
      }
    }
  });

  function setOptions(next) {
    choices = Array.isArray(next) ? next : [];
    if (selected && !choices.some((opt) => opt.value === selected)) {
      selected = "";
      filtering = false;
      query = "";
      paintInput();
    }
    if (!list.hidden) {
      renderList();
      place();
    }
  }

  function setValue(next, silent = false) {
    selected = next || "";
    filtering = false;
    query = "";
    paintInput();
    if (!silent && onChange) {
      onChange(selected);
    }
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    openCombos.delete(api);
    list.remove();
  }

  const api = {
    element,
    input,
    list,
    place,
    close,
    destroy,
    seen: false,
    getValue: () => selected,
    setValue,
    setOptions,
  };
  paintInput();
  openCombos.add(api);
  return api;
}

export function controlForField(field, value, onValue) {
  const current = value === null || value === undefined ? "" : String(value);
  const selectable = field.tipo === "boolean" || (field.tipo === "select" && Array.isArray(field.opciones) && field.opciones.length);
  if (selectable) {
    const options =
      field.tipo === "boolean"
        ? [
            { value: "Sí", label: "Sí" },
            { value: "No", label: "No" },
          ]
        : field.opciones.map((item) => {
            const option = typeof item === "string" ? item : item.value || item.label || "";
            return { value: option, label: option };
          });
    return createCombo({
      options,
      value: current,
      emptyLabel: "—",
      placeholder: field.nombre,
      ariaLabel: field.nombre,
      onChange: onValue,
    }).element;
  }
  const input = h("input", {
    class: "app-input",
    type: field.tipo === "number" ? "number" : "text",
    step: field.tipo === "number" ? "any" : undefined,
    "aria-label": field.nombre,
  });
  input.value = current;
  input.addEventListener("input", () => onValue(input.value));
  return input;
}
