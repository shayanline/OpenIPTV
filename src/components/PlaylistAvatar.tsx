export function PlaylistAvatar({ name, number }: { name: string; number: number | string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toLocaleUpperCase() || "?";
  return (
    <span className="playlist-avatar" aria-hidden="true">
      <span className="playlist-avatar-initials">{initials}</span>
      <span className="playlist-avatar-number">{number}</span>
    </span>
  );
}
