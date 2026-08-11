export interface Channel {
  /** tvg-id, stable across playlist refreshes, so it is what favourites key on. */
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  language: string;
  quality: string;
  /** Position in the playlist, used for the number key jump. */
  number: number;
}

export interface Category {
  name: string;
  channels: Channel[];
}
