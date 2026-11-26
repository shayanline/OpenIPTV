import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  artworkOf,
  claimArtwork,
  loadArtwork,
  loadArtworkPalette,
  peekArtworkPalette,
  releaseArtwork,
  subscribeArtwork,
  paletteCss,
  type ArtworkKind,
} from "../services/artwork";
import { observeArtworkVisibility } from "../services/artworkVisibility";
import { Icon } from "./Icon";

export interface ArtworkProps {
  src?: string;
  alt: string;
  kind: ArtworkKind;
  width: number;
  height: number;
  fit?: "cover" | "contain";
  placeholderIcon: "tv" | "movie" | "series" | "episode";
  className?: string;
  fetchable?: boolean;
  intrinsic?: boolean;
  placeholder?: React.ReactNode;
  palette?: { primary: string; secondary: string };
  onPalette?: (palette: { primary: string; secondary: string }) => void;
}

export const Artwork = memo(function Artwork({
  src,
  alt,
  kind,
  width,
  height,
  fit,
  placeholderIcon,
  className = "artwork",
  fetchable = true,
  intrinsic = false,
  placeholder,
  palette,
  onPalette,
}: ArtworkProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stopObservation = useRef<(() => void) | null>(null);
  const [inView, setInView] = useState(false);
  const request = useMemo(
    () =>
      src
        ? {
            url: src,
            kind,
            width,
            height,
            ...(fit === "contain" ? { fit: "contain" as const } : {}),
          }
        : null,
    [src, kind, width, height, fit],
  );
  const subscribe = useCallback(
    (listener: () => void) => (request ? subscribeArtwork(request, listener) : () => {}),
    [request],
  );
  const getSnapshot = useCallback(() => (request ? artworkOf(request) : null), [request]);
  const entry = useSyncExternalStore(subscribe, getSnapshot);

  const observe = useCallback(
    (element: HTMLCanvasElement | HTMLSpanElement | null) => {
      stopObservation.current?.();
      stopObservation.current = null;
      canvas.current = element instanceof HTMLCanvasElement ? element : null;
      if (!element) return;
      if (!request || !fetchable) {
        setInView(false);
        return;
      }
      stopObservation.current = observeArtworkVisibility(element, setInView);
    },
    [request, fetchable],
  );

  useEffect(() => {
    if (!request || !fetchable || !inView) return;
    claimArtwork(request);
    void loadArtwork(request);
    return () => {
      releaseArtwork(request);
    };
  }, [request, fetchable, inView]);

  useEffect(() => {
    if (!entry || !onPalette) return;
    const cached = peekArtworkPalette(entry.bitmap);
    if (cached) {
      onPalette(cached);
      return;
    }
    let current = true;
    void loadArtworkPalette(entry.bitmap).then((palette) => {
      if (current) onPalette(palette);
    });
    return () => {
      current = false;
    };
  }, [entry, onPalette]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !entry) return;
    const context = element.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, element.width, element.height);
    try {
      if (!intrinsic && (kind === "logo" || fit === "contain")) {
        const scale = Math.min(width / entry.bitmap.width, height / entry.bitmap.height);
        const drawWidth = entry.bitmap.width * scale;
        const drawHeight = entry.bitmap.height * scale;
        context.drawImage(
          entry.bitmap,
          (width - drawWidth) / 2,
          (height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
      } else {
        const drawWidth = intrinsic ? entry.bitmap.width : width;
        const drawHeight = intrinsic ? entry.bitmap.height : height;
        context.drawImage(entry.bitmap, 0, 0, drawWidth, drawHeight);
      }
    } catch {
      return;
    }
  }, [entry, width, height, intrinsic, kind, fit]);

  if (!entry) {
    return (
      <span
        ref={observe}
        className={`${className} placeholder`}
        aria-label={alt}
        role="img"
        style={palette ? { background: paletteCss(palette) } : undefined}
      >
        {placeholder ?? <Icon name={placeholderIcon} />}
      </span>
    );
  }

  return (
    <canvas
      ref={observe}
      className={className}
      width={intrinsic ? entry.bitmap.width : width}
      height={intrinsic ? entry.bitmap.height : height}
      aria-label={alt}
      role="img"
    />
  );
});
