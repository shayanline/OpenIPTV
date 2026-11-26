import { memo } from "react";
import { Artwork } from "./Artwork";

export const Logo = memo(function Logo({
  src,
  alt,
  width,
  height,
  className = "ch-logo",
  fetchable = true,
}: {
  src?: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  fetchable?: boolean;
}) {
  return (
    <Artwork
      src={src}
      alt={alt}
      kind="logo"
      width={width}
      height={height}
      className={`${className} logo-artwork`}
      placeholderIcon="tv"
      fetchable={fetchable}
    />
  );
});
