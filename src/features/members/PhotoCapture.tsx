import { Camera, ImageUp, RotateCcw, Trash, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PhotoInput } from "@/api/bindings";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/menus";
import { loadImageFile, processImage } from "@/lib/photo";
import { cn } from "@/lib/utils";

/** The camera last used on this PC (built-in vs USB webcam). A per-PC convenience only. */
const CAMERA_KEY = "df.camera";

function rememberedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

function rememberCamera(id: string) {
  try {
    localStorage.setItem(CAMERA_KEY, id);
  } catch {
    // Storage unavailable: the default camera is used next time.
  }
}

/** Opens the chosen camera if it is still connected, otherwise Windows' default camera. */
async function openCamera(deviceId: string | null): Promise<MediaStream> {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...size, deviceId: { exact: deviceId } },
        audio: false,
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      // Unplugged since last time: fall back to the default camera.
      if (name !== "OverconstrainedError" && name !== "NotFoundError") throw e;
    }
  }
  return navigator.mediaDevices.getUserMedia({ video: size, audio: false });
}

/** Plain-language reason a camera did not start (and whether Windows Settings can fix it). */
export function cameraProblem(e: unknown): { message: string; windowsSettings: boolean } {
  switch ((e as DOMException | undefined)?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        message:
          "Windows is not letting apps use the camera. Turn on camera access in Windows Settings, or upload a photo instead.",
        windowsSettings: true,
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        message:
          "No camera found. Connect a USB webcam or switch on the laptop camera (some laptops have a camera key or a sliding cover), or upload a photo.",
        windowsSettings: false,
      };
    case "NotReadableError":
    case "AbortError":
      return {
        message:
          "The camera is busy or switched off. Close other apps using it (Zoom, WhatsApp, Camera) and try again.",
        windowsSettings: false,
      };
    default:
      return {
        message: "Could not start the camera. Try again, or upload a photo instead.",
        windowsSettings: false,
      };
  }
}

/**
 * Webcam capture (built-in laptop camera or USB webcam) or file upload, producing a square-cropped JPEG + thumbnail.
 * `value` is the new photo (data URLs) or null; `currentUrl` shows the saved photo when editing.
 */
export function PhotoCapture({
  value,
  onChange,
  currentUrl,
  onRemoveCurrent,
  className,
}: {
  value: PhotoInput | null;
  onChange: (photo: PhotoInput | null) => void;
  currentUrl?: string | null;
  onRemoveCurrent?: () => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The live stream is kept in a ref too, so it can always be switched off (unmount, camera change).
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);

  const release = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setStream(null);
    setReady(false);
  }, [release]);

  // Switch the camera (and its light) off when the form closes.
  useEffect(() => release, [release]);

  useEffect(() => {
    const video = videoRef.current;
    if (stream && video) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
  }, [stream]);

  // Keep the camera list current while the preview is open (USB webcams plugged in or out).
  useEffect(() => {
    if (!stream) return;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCameras(devices.filter((d) => d.kind === "videoinput" && d.deviceId)));
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [stream]);

  const start = async (deviceId: string | null = rememberedCamera()) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("A camera cannot be used on this PC. Upload a photo instead.");
      return;
    }
    setStarting(true);
    // Some webcams cannot be opened twice: close the current one before switching.
    release();
    setReady(false);
    try {
      const s = await openCamera(deviceId);
      streamRef.current = s;
      const track = s.getVideoTracks()[0];
      const id = track?.getSettings().deviceId ?? null;
      setCameraId(id);
      if (id) rememberCamera(id);
      track?.addEventListener("ended", () => {
        if (streamRef.current !== s) return;
        toast.error("The camera was disconnected.");
        stop();
      });
      setStream(s);
    } catch (e) {
      stop();
      const problem = cameraProblem(e);
      toast.error(problem.message, {
        duration: 10_000,
        action: problem.windowsSettings
          ? { label: "Camera settings", onClick: () => void api.app.openCameraSettings() }
          : undefined,
      });
    } finally {
      setStarting(false);
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    onChange(processImage(v, v.videoWidth, v.videoHeight));
    stop();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadImageFile(file);
      onChange(processImage(img, img.naturalWidth, img.naturalHeight));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const shown = value?.photo ?? currentUrl ?? null;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative aspect-square w-full max-w-[220px] overflow-hidden rounded-2xl border-2 border-dashed bg-muted">
        {stream ? (
          <>
            {/* Mirrored like a mirror while framing; the saved photo is not mirrored. */}
            <video
              ref={videoRef}
              muted
              playsInline
              onPlaying={() => setReady(true)}
              className="size-full scale-x-[-1] object-cover"
            />
            <div className="pointer-events-none absolute inset-6 rounded-full border-2 border-white/60" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                Starting camera…
              </div>
            )}
          </>
        ) : shown ? (
          <img src={shown} alt="Member" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <UserRound className="size-14" strokeWidth={1.2} />
            <span className="text-xs">No photo yet</span>
          </div>
        )}
      </div>
      {stream && cameras.length > 1 && (
        <Select
          className="h-8 w-full max-w-[220px] text-xs"
          aria-label="Camera"
          value={cameraId ?? ""}
          onValueChange={(id) => void start(id)}
          options={cameras.map((c, i) => ({ value: c.deviceId, label: c.label || `Camera ${i + 1}` }))}
        />
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {stream ? (
          <>
            <Button size="sm" onClick={capture} disabled={!ready}>
              <Camera /> Capture
            </Button>
            <Button size="sm" variant="outline" onClick={stop}>
              <X /> Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => void start()} loading={starting}>
              {shown ? <RotateCcw /> : <Camera />} {shown ? "Retake" : "Webcam"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <ImageUp /> Upload
            </Button>
            {(value || (currentUrl && onRemoveCurrent)) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (value ? onChange(null) : onRemoveCurrent?.())}
                aria-label="Remove photo"
              >
                <Trash />
              </Button>
            )}
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Upload photo"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
