export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) {
      return;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "checked" || key === "disabled" || key === "selected") {
      node[key] = Boolean(value);
    } else {
      node.setAttribute(key, value);
    }
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) {
      return;
    }
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function openModal({ title, fields, confirmLabel = "Guardar" }) {
  return new Promise((resolve) => {
    const back = h("div", { class: "modal-back" });
    const form = h("form", { class: "glass modal" });
    form.append(h("h3", {}, title));
    const values = {};
    (fields || []).forEach((field) => {
      const input =
        field.type === "select"
          ? h(
              "select",
              { class: "app-select", name: field.name },
              ...(field.options || []).map((opt) =>
                h("option", { value: opt.value, selected: opt.value === field.value }, opt.label)
              )
            )
          : h("input", {
              class: "app-input",
              name: field.name,
              type: field.type || "text",
              value: field.value || "",
              required: field.required ? "required" : undefined,
            });
      form.append(
        h("label", { class: "field-row" }, h("span", {}, field.label), input)
      );
    });
    const cancel = h("button", { class: "btn ghost", type: "button" }, "Cancelar");
    cancel.addEventListener("click", () => {
      back.remove();
      resolve(null);
    });
    form.append(h("div", { class: "modal-actions" }, cancel, h("button", { class: "btn", type: "submit" }, confirmLabel)));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      data.forEach((value, key) => {
        values[key] = String(value).trim();
      });
      back.remove();
      resolve(values);
    });
    back.append(form);
    document.body.append(back);
    const first = form.querySelector("input, select");
    if (first) {
      first.focus();
    }
  });
}
