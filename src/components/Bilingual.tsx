/**
 * Renders "English | فارسی" with each half in its own direction.
 *
 * Left to right and right to left text in one element is laid out by the bidirectional
 * algorithm, which moves trailing punctuation and any latin fragment inside the Persian
 * to the wrong end. Splitting the halves and marking each one keeps both readable, and is
 * why the playlist emits the two names either side of a pipe.
 *
 * `language` lets a viewer who reads only one of them hide the other.
 */
const PERSIAN = /[\u0600-\u06FF]/;

interface Props {
  value: string;
  className?: string;
  language?: string;
}

export function Bilingual({ value, className = "", language = "auto" }: Props) {
  const parts = value.split(" | ");

  if (parts.length > 1 && language !== "auto") {
    const wanted = language === "fa"
      ? parts.find((p) => PERSIAN.test(p))
      : parts.find((p) => !PERSIAN.test(p));
    const only = wanted ?? parts[0];
    return <span className={className} dir={PERSIAN.test(only) ? "rtl" : "ltr"}>{only}</span>;
  }

  if (parts.length < 2) {
    return <span className={className} dir={PERSIAN.test(value) ? "rtl" : "ltr"}>{value}</span>;
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
