// In the browser: shrink a photo before it's sent. Phone photos are often 3 to
// 10 MB; the app's host accepts about 4.5 MB per request, and Claude reads
// images best at about 1,600 pixels. A JPEG this size is roughly 300 to 500 KB.

export interface ShrunkPhoto {
  data: string; // base64, no data: prefix
  mediaType: "image/jpeg";
  preview: string; // a data: URL for thumbnails
}

const MAX_EDGE = 1600;
const QUALITY = 0.82;

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be opened as a photo."));
    };
    img.src = url;
  });
}

export async function shrinkPhoto(file: File): Promise<ShrunkPhoto> {
  // Browsers turn the image upright from its camera orientation when drawing it.
  const img = await load(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare photos.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", QUALITY);
  return { data: preview.slice(preview.indexOf(",") + 1), mediaType: "image/jpeg", preview };
}
