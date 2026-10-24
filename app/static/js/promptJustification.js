import { h } from "./dom.js";

export function promptJustification(title, hint = "Indique el motivo. Este texto queda en la bitácora.") {
  return new Promise((resolve) => {
    const back = h("div", { class: "modal-back" });
    const box = h("div", { class: "glass modal" });
    const text = h("textarea", { class: "app-input", rows: "4", placeholder: hint });
    const status = h("p", { class: "muted" }, "");
    const cancel = h("button", { class: "btn ghost", type: "button" }, "Cancelar");
    const ok = h("button", { class: "btn", type: "button" }, "Confirmar");
    const close = (value) => {
      back.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => close(null));
    back.addEventListener("click", (event) => {
      if (event.target === back) {
        close(null);
      }
    });
    ok.addEventListener("click", () => {
      const value = text.value.trim();
      if (value.length < 3) {
        status.textContent = "Escriba al menos 3 caracteres de justificación.";
        return;
      }
      close(value);
    });
    box.append(h("h3", {}, title), h("label", { class: "field-row" }, "Justificación", text), status, h("div", { class: "modal-actions" }, cancel, ok));
    back.append(box);
    document.body.append(back);
    text.focus();
  });
}
