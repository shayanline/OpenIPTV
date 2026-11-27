export function artworkSourceUrl(url: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return url;
  const thumbnail = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)w(\d+)\//.exec(url);
  if (!thumbnail || Number(thumbnail[2]) >= width) return url;
  const size =
    width <= 300 ? "w300" : width <= 780 ? "w780" : width <= 1280 ? "w1280" : "original";
  return `${thumbnail[1]}${size}/${url.slice(thumbnail[0].length)}`;
}
