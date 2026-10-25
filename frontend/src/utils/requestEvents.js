// Sent after a request is created, edited or reviewed, so views outside the page that made
// the change (the notification bell in the navbar) can reload.
const REQUESTS_CHANGED = 'siit:requests-changed';

export function notifyRequestsChanged() {
  window.dispatchEvent(new Event(REQUESTS_CHANGED));
}

export function onRequestsChanged(handler) {
  window.addEventListener(REQUESTS_CHANGED, handler);
  return () => window.removeEventListener(REQUESTS_CHANGED, handler);
}
