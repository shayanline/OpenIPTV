export interface PlaybackTarget {
  id: string;
  playlistId: string;
  mode: "live" | "finite";
  kind: "live" | "movie" | "episode" | "catchup";
  name: string;
  group: string;
  logo: string;
  year?: string;
  rating?: string;
  url: string;
  resumeAt?: number;
  /** The seed progress records are written from, so persisted state never holds a media URL. */
  progress?: PlaybackProgressSeed;
}

export interface Channel {
  /** tvg-id, stable across playlist refreshes, so it is what favourites key on. */
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  quality: string;
  /** Position in the playlist, used for the number key jump. */
  number: number;
  categoryKey?: string;
  sourceFingerprint?: string;
  xtream?: {
    playlistId: string;
    streamId: string;
    categoryKey: string;
    archiveDays: number;
    directSource: string;
  };
}

export type TuneItem = Channel | PlaybackTarget;

/**
 * Where playback was asked for, so leaving a finite picture returns to the screen that
 * started it rather than to a generic list.
 */
export interface PlaybackReturnRoute {
  surface: "live-browser" | "movie-details" | "series-details" | "episode" | "guide";
  itemKey: string;
}

export type PlaybackPhase =
  | "idle"
  | "connecting"
  | "playing"
  | "rebuffering"
  | "recovering"
  | "paused"
  | "seeking"
  | "ended"
  | "failed";

export interface SeekRange {
  startSeconds: number;
  endSeconds: number;
  liveEdge: boolean;
}

export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  /** The viewer's pause choice, independent of loading and temporary engine pauses. */
  paused: boolean;
  target: PlaybackTarget | null;
  position: number | null;
  duration: number | null;
  seekRange: SeekRange | null;
  bufferedPercent: number | null;
  recoveryAttempt: number;
  recoveryIn: number;
  fault: string | null;
}

export interface QuickSeekState {
  /** Signed accumulation of every direction press since the seek began settling. */
  deltaSeconds: number;
  /** Where the playhead lands once the settle timer commits the seek. */
  targetSeconds: number;
}

export interface MediaTrack {
  id: string;
  identity: string;
  engineIndex: number;
  kind: "audio" | "subtitle";
  label: string;
  language: string;
  selected: boolean;
  accessibility?: "sdh" | "descriptions";
}

export interface PlaybackProgressSeed {
  itemKey: string;
  legacyItemKeys?: readonly string[];
  playlistId: string;
  kind: "movie" | "episode" | "catchup";
  providerId?: string;
  episodeIdentity?: string;
  directSourceFingerprint?: string;
  categoryKey: string;
  extension?: string;
  name: string;
  logo: string;
  parentKey?: string;
  parentProviderId?: string;
  parentName?: string;
  season?: number;
  episode?: number;
}
