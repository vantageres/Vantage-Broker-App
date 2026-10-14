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

// The phone's location, to find the property a sign stands at. Asked only
// when a photo is sent from a phone; the phone asks the broker's permission
// the first time. Denied or off means no location; slow gives up after about 5 seconds.
export function phoneLocation(timeoutMs = 5000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
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
