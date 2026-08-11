interface Props {
  categories: string[];
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

export function Sidebar({ categories, selected, focused, onSelect }: Props) {
  return (
    <nav className={`sidebar ${focused ? "focused" : ""}`}>
      {categories.map((name, i) => (
        <button
          key={name}
          type="button"
          className={`category ${i === selected ? "selected" : ""}`}
          onClick={() => onSelect(i)}
        >
          {/* Bilingual group titles arrive as "English | فارسی". Stacking them keeps the
              rail narrow and stops the Persian half being clipped. */}
          {name.split(" | ").map((part, n) => (
            <span key={n} className={n ? "fa" : "en"}>{part}</span>
          ))}
        </button>
      ))}
    </nav>
  );
}
