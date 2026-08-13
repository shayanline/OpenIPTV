/**
 * Icons, drawn on a 24 grid.
 *
 * Two families, because at three metres they behave differently: transport and status
 * glyphs are solid, since a filled triangle reads instantly where an outlined one turns
 * to mush, and navigational glyphs are single stroke with round caps, which is One UI's
 * lighter, geometric character. Everything takes its colour from the text around it.
 */
const SOLID = new Set(["settings", "pause", "star"]);

const paths: Record<string, React.ReactNode> = {
  settings: (
    <path d="M19.4 12c0-.45-.04-.88-.11-1.3l2.06-1.55a.5.5 0 0 0 .12-.64l-1.95-3.38a.5.5 0 0 0-.6-.22l-2.42.97a7.6 7.6 0 0 0-2.25-1.3l-.37-2.58a.5.5 0 0 0-.49-.42h-3.9a.5.5 0 0 0-.49.42l-.37 2.58c-.82.31-1.57.75-2.25 1.3l-2.42-.97a.5.5 0 0 0-.6.22L1.41 8.51a.5.5 0 0 0 .12.64l2.06 1.55a8.1 8.1 0 0 0 0 2.6l-2.06 1.55a.5.5 0 0 0-.12.64l1.95 3.38a.5.5 0 0 0 .6.22l2.42-.97c.68.55 1.43.99 2.25 1.3l.37 2.58a.5.5 0 0 0 .49.42h3.9a.5.5 0 0 0 .49-.42l.37-2.58a7.6 7.6 0 0 0 2.25-1.3l2.42.97a.5.5 0 0 0 .6-.22l1.95-3.38a.5.5 0 0 0-.12-.64l-2.06-1.55c.07-.42.11-.85.11-1.3Zm-7.4 3.65A3.65 3.65 0 1 1 15.65 12 3.65 3.65 0 0 1 12 15.65Z" />
  ),
  pause: <path d="M8.4 5.4h3.1v13.2H8.4zM12.5 5.4h3.1v13.2h-3.1z" />,
  star: <path d="M12 3.6l2.58 5.23 5.77.84-4.18 4.07.99 5.75L12 16.77l-5.16 2.72.99-5.75-4.18-4.07 5.77-.84z" />,
  /* Something is wrong, said as calmly as a symbol can. A round outline rather than the usual
     triangle: a triangle is a hazard, and a channel that is off the air is not a danger, it is
     a disappointment. */
  warn: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.4v5.4" />
      <path d="M12 16.2v.1" />
    </>
  ),
  /* Stands in for artwork a channel did not supply. A television, because that is what the
     missing thing is a picture of, and it says "nothing to show here" in no language at all. */
  tv: (
    <>
      <rect x="2.6" y="5" width="18.8" height="13" rx="2.2" />
      <path d="M8.6 21h6.8" />
    </>
  ),
};

type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  const solid = SOLID.has(name);
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
         fill={solid ? "currentColor" : "none"}
         stroke={solid ? "none" : "currentColor"}
         strokeWidth={solid ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
