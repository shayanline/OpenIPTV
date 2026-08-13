/**
 * A run of text from the playlist, laid out in whichever direction it is written in.
 *
 * Playlists come from everywhere, so a channel name may be Latin, Arabic, Hebrew, Thai,
 * Cyrillic or a mix. `dir="auto"` hands the decision to the browser, which picks the base
 * direction from the first strong character, so a right to left name is not left aligned
 * with its punctuation flung to the wrong end. The app makes no assumption about which
 * language a playlist is in and never tries to split a name into parts.
 */
export function Text({ value, className = "" }: { value: string; className?: string }) {
  return <span className={className} dir="auto">{value}</span>;
}
