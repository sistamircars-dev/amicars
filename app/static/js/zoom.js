import { PLACEHOLDER } from "./catalog.js";

export function mountZoom(stage) {
  const img = stage.querySelector("img.zoom-base");
  if (!img) {
    return;
  }
  const lens = document.createElement("div");
  lens.className = "zoom-lens";
  const map = document.createElement("div");
  map.className = "zoom-minimap";
  const mapImg = document.createElement("img");
  mapImg.alt = "";
  const rect = document.createElement("div");
  rect.className = "zoom-rect";
  map.append(mapImg, rect);
  stage.append(lens, map);

  const scale = 3;
  const lensW = 170;
  const lensH = 170;

  function hide() {
    lens.hidden = true;
    map.hidden = true;
  }

  function move(event) {
    if (!img.dataset.full || img.dataset.full === PLACEHOLDER || img.dataset.empty === "1") {
      hide();
      return;
    }
    const box = img.getBoundingClientRect();
    if (!box.width || !box.height) {
      return;
    }
    const x = Math.min(Math.max(event.clientX - box.left, 0), box.width);
    const y = Math.min(Math.max(event.clientY - box.top, 0), box.height);
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const fit = natW && natH ? Math.max(box.width / natW, box.height / natH) : 1;
    const dispW = natW && natH ? natW * fit : box.width;
    const dispH = natW && natH ? natH * fit : box.height;
    const offsetX = (box.width - dispW) / 2;
    const offsetY = (box.height - dispH) / 2;
    lens.hidden = false;
    map.hidden = false;
    mapImg.src = img.dataset.full;
    lens.style.width = `${lensW}px`;
    lens.style.height = `${lensH}px`;
    const left = Math.min(Math.max(x - lensW / 2, 0), stage.clientWidth - lensW);
    const top = Math.min(Math.max(y - lensH / 2, 0), stage.clientHeight - lensH);
    lens.style.left = `${left}px`;
    lens.style.top = `${top}px`;
    lens.style.backgroundImage = `url("${img.dataset.full}")`;
    lens.style.backgroundRepeat = "no-repeat";
    lens.style.backgroundSize = `${dispW * scale}px ${dispH * scale}px`;
    lens.style.backgroundPosition = `${-((x - offsetX) * scale - lensW / 2)}px ${-((y - offsetY) * scale - lensH / 2)}px`;

    const mapW = map.clientWidth || 84;
    const mapH = map.clientHeight || 84;
    const sx = mapW / box.width;
    const sy = mapH / box.height;
    mapImg.style.width = `${dispW * sx}px`;
    mapImg.style.height = `${dispH * sy}px`;
    mapImg.style.left = `${offsetX * sx}px`;
    mapImg.style.top = `${offsetY * sy}px`;
    const rw = Math.max(8, (lensW / scale / box.width) * mapW);
    const rh = Math.max(8, (lensH / scale / box.height) * mapH);
    const rx = Math.min(Math.max((x / box.width) * mapW - rw / 2, 0), mapW - rw);
    const ry = Math.min(Math.max((y / box.height) * mapH - rh / 2, 0), mapH - rh);
    rect.style.width = `${rw}px`;
    rect.style.height = `${rh}px`;
    rect.style.left = `${rx}px`;
    rect.style.top = `${ry}px`;
  }

  hide();
  stage.addEventListener("mousemove", move);
  stage.addEventListener("mouseleave", hide);
}
