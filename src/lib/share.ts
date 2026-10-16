import { downloadBlob } from "@/lib/excel";

/** O telemóvel consegue enviar ficheiros (WhatsApp, email, Bluetooth…) pela partilha do sistema? */
export function canShareFiles() {
  try {
    if (typeof navigator === "undefined" || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/** Envia o ficheiro pela partilha do sistema; sem partilha, descarrega. */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: title });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
