import { useRef } from "react";
import { Bilingual } from "./Bilingual";
import { ScrollIndicator } from "./ScrollIndicator";

interface Props {
  categories: { name: string; count: number }[];
  selected: number;
  focused: boolean;
  language: string;
  onSelect: (index: number) => void;
}

export function Sidebar({ categories, selected, focused, language, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLButtonElement>(null);

  return (
    <nav className={`rail pane ${focused ? "focused" : ""}`}>
      <p className="panel-title">Categories</p>
      <div className="rail-scroll" ref={scroller}>
        {categories.map((c, i) => (
          <button
            key={c.name}
            ref={i === selected ? row : undefined}
            type="button"
            className={`row ${i === selected ? "selected" : ""}`}
            onClick={() => onSelect(i)}
          >
            <Bilingual value={c.name} className="category-name" language={language} />
            <span className="category-count muted">{c.count}</span>
          </button>
        ))}
      </div>
      <ScrollIndicator target={scroller} deps={[selected, categories.length]} />
    </nav>
  );
}
