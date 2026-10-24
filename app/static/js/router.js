import { h } from "./dom.js";
import { clearRouteParams, onNavigate } from "./nav.js";
import { VIEWS } from "./views.js?v=45";

export async function startRouter() {
  const root = document.getElementById("view-root");
  const nav = document.getElementById("nav-list");
  const shell = document.getElementById("app-shell");
  const sidebar = document.getElementById("sidebar");

  const showHot = () => shell.classList.add("sidebar-hot");
  const hideHot = () => shell.classList.remove("sidebar-hot");
  sidebar.addEventListener("pointerenter", showHot);
  sidebar.addEventListener("pointerleave", hideHot);
  sidebar.addEventListener("focusin", showHot);
  sidebar.addEventListener("focusout", (event) => {
    if (!sidebar.contains(event.relatedTarget)) {
      hideHot();
    }
  });

  Object.entries(VIEWS).forEach(([id, view]) => {
    const button = h(
      "button",
      { class: "nav-btn", type: "button", "data-view": id, title: view.label, "aria-label": view.label },
      h("span", { class: "nav-icon", "aria-hidden": "true" }, view.icon || "•"),
      h("span", { class: "nav-label" }, view.label)
    );
    button.addEventListener("click", () => {
      clearRouteParams();
      showView(id);
    });
    nav.append(button);
  });

  async function showView(id) {
    const resolved = VIEWS[id] ? id : "inventario";
    const view = VIEWS[resolved];
    nav.querySelectorAll(".nav-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === resolved);
    });
    root.classList.remove("panel-compact");
    await view.render(root);
  }

  onNavigate((view) => showView(view));
  await showView("inventario");
}
