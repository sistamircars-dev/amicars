let params = {};
let handler = null;

export function onNavigate(fn) {
  handler = fn;
}

export function getRouteParams() {
  return params;
}

export function clearRouteParams() {
  params = {};
}

export function go(view, next = {}) {
  params = next || {};
  if (handler) {
    return handler(view);
  }
  return null;
}
