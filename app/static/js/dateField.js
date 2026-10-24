import { h } from "./dom.js";
import { formatDisplayDate, parseDisplayDate } from "./movements.js?v=27";

function maskDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function createDateField({ value = "", ariaLabel = "Fecha" } = {}) {
  const visible = h("input", {
    class: "app-input date-display",
    type: "text",
    inputmode: "numeric",
    placeholder: "DD/MM/AAAA",
    maxlength: "10",
    autocomplete: "off",
    "aria-label": ariaLabel,
  });
  const picker = h("input", {
    class: "date-picker",
    type: "date",
    tabindex: "-1",
    "aria-hidden": "true",
  });
  picker.style.cssText = "position:absolute;right:0;top:0;width:2.4rem;height:100%;opacity:0;color:transparent;border:0;background:transparent";
  const wrap = h("div", { class: "date-field" }, visible, picker);
  wrap.style.position = "relative";

  Object.defineProperty(wrap, "value", {
    get() {
      return picker.value;
    },
    set(iso) {
      picker.value = iso || "";
      visible.value = iso ? formatDisplayDate(iso) : "";
    },
  });

  visible.addEventListener("input", () => {
    visible.value = maskDate(visible.value);
    const iso = parseDisplayDate(visible.value);
    if (iso) {
      picker.value = iso;
    }
  });
  visible.addEventListener("change", (event) => {
    event.stopPropagation();
    const iso = parseDisplayDate(visible.value);
    if (iso) {
      wrap.value = iso;
    } else if (picker.value) {
      visible.value = formatDisplayDate(picker.value);
    } else {
      visible.value = "";
    }
    wrap.dispatchEvent(new Event("change", { bubbles: true }));
  });
  picker.addEventListener("change", (event) => {
    event.stopPropagation();
    visible.value = picker.value ? formatDisplayDate(picker.value) : "";
    wrap.dispatchEvent(new Event("change", { bubbles: true }));
  });

  wrap.value = value;
  return wrap;
}
