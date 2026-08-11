import { Bilingual } from "./Bilingual";

interface Props {
  categories: { name: string; count: number }[];
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

export function Sidebar({ categories, selected, focused, onSelect }: Props) {
  return (
    <nav className={`sidebar ${focused ? "focused" : ""}`}>
      {categories.map((c, i) => (
        <button
          key={c.name}
          type="button"
          className={`category ${i === selected ? "selected" : ""}`}
          onClick={() => onSelect(i)}
        >
          <Bilingual value={c.name} />
          <span className="count">{c.count}</span>
        </button>
      ))}
    </nav>
  );
}
