export function redirectTopLevel(url: string) {
  if (typeof window === "undefined") return;
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
      return;
    }
  } catch {
  }
  window.location.href = url;
}
