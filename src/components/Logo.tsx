import { memo } from "react";
import { Artwork } from "./Artwork";

export const Logo = memo(function Logo({
  src,
  alt,
  label,
  width,
  height,
  className = "ch-logo",
  intrinsic = false,
  fetchable = true,
}: {
  src?: string;
  alt: string;
  label?: string;
  width: number;
  height: number;
  className?: string;
  fetchable?: boolean;
  intrinsic?: boolean;
}) {
  return (
    <Artwork
      src={src}
      alt={alt}
      kind="logo"
      width={width}
      height={height}
      className={className}
      placeholderIcon="tv"
      placeholder={label}
      fetchable={fetchable}
      intrinsic={intrinsic}
    />
  );
});
