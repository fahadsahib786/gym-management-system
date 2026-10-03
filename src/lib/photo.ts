/** Member photos: URLs for the `photo://` protocol and client-side resize/crop before upload. */

const isWindows = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

/** Photo URL, or null when the member has no photo (version 0). The version busts the cache on change. */
export function photoUrl(memberId: string, version: number, thumb = false): string | null {
  if (!version) return null;
  const base = isWindows ? "http://photo.localhost/" : "photo://localhost/";
  return `${base}${encodeURIComponent(memberId)}?v=${version}${thumb ? "&thumb=1" : ""}`;
}

export interface ProcessedPhoto {
  photo: string;
  thumb: string;
}

function drawSquare(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  size: number,
  quality: number,
): string {
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  // Bias the crop slightly upward: faces sit in the upper part of webcam frames.
  const sy = Math.max(0, (sh - side) / 2 - (sh - side) * 0.15);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Square-crops and resizes to a 480 px photo (~40 KB) and a 112 px thumbnail (~4 KB). */
export function processImage(source: CanvasImageSource, width: number, height: number): ProcessedPhoto {
  return {
    photo: drawSquare(source, width, height, 480, 0.85),
    thumb: drawSquare(source, width, height, 112, 0.8),
  };
}

export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "This photo could not be read. Please choose a JPG or PNG picture (iPhone HEIC photos: send them as JPG).",
        ),
      );
    };
    img.src = url;
  });
}
