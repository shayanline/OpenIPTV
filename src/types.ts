export interface PlaybackTarget {
  id: string;
  playlistId: string;
  mode: "live" | "finite";
  kind: "live" | "movie" | "episode" | "catchup";
  name: string;
  group: string;
  logo: string;
  url: string;
  /** The provider-advertised address, tried once if the configured one cannot play. */
  fallbackUrl?: string;
  resumeAt?: number;
}

export interface Channel {
  /** tvg-id, stable across playlist refreshes, so it is what favourites key on. */
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  /** The provider-advertised address, tried once if the configured one cannot play. */
  fallbackUrl?: string;
  quality: string;
  /** Position in the playlist, used for the number key jump. */
  number: number;
  xtream?: {
    playlistId: string;
    streamId: string;
    categoryKey: string;
    archiveDays: number;
    directSource: string;
  };
}
