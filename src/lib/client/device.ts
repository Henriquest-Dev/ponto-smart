/**
 * Identificador local do dispositivo (guardado no navegador). Numa PWA não é
 * possível identificar hardware de forma infalível: é apenas um factor adicional.
 */
const KEY = "ps_device_key";

export function getDeviceKey(): string | null {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}
