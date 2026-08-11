/**
 * Renders "English | فارسی" with each half in its own direction.
 *
 * Left to right and right to left text in one element is laid out by the bidirectional
 * algorithm, which moves trailing punctuation and any latin fragment inside the Persian
 * to the wrong end. Splitting the halves and marking the Persian one dir="rtl" keeps
 * each readable, and is why the playlist emits the two names either side of a pipe.
 */
const PERSIAN = /[\u0600-\u06FF]/;

export function Bilingual({ value, className = "" }: { value: string; className?: string }) {
  const parts = value.split(" | ");
  if (parts.length < 2) {
    return (
      <span className={className} dir={PERSIAN.test(value) ? "rtl" : "ltr"}>{value}</span>
    );
  }
  return (
    <span className={`bilingual ${className}`}>
      {parts.map((part, i) => (
        <span key={i} dir={PERSIAN.test(part) ? "rtl" : "ltr"} className={i ? "fa" : "en"}>
          {part}
        </span>
      ))}
    </span>
  );
}
