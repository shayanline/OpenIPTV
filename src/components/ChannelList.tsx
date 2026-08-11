import { useEffect, useRef } from "react";
import type { Channel } from "../types";
import { Bilingual } from "./Bilingual";

interface Props {
  channels: Channel[];
  index: number;
  focused: boolean;
  playingId: string;
  favourites: string[];
  loading: boolean;
  onSelect: (channel: Channel, index: number) => void;
}

export function ChannelList({ channels, index, focused, playingId, favourites, loading, onSelect }: Props) {
  const rowRef = useRef<HTMLButtonElement>(null);

  // The remote moves the selection, so the list follows it rather than the pointer.
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (loading && !channels.length) {
    return (
      <div className="channels">
        {Array.from({ length: 9 }, (_, i) => (
          <div className="channel skeleton" key={i}>
            <span className="sk sk-logo" />
            <span className="sk sk-title" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`channels ${focused ? "focused" : ""}`}>
      {channels.map((c, i) => (
        <button
          key={c.id}
          ref={i === index ? rowRef : undefined}
          type="button"
          className={`channel ${i === index ? "selected" : ""} ${c.id === playingId ? "playing" : ""}`}
          onClick={() => onSelect(c, i)}
        >
          <span className="number">{c.number}</span>
          {c.logo
            ? <img className="logo" src={c.logo} alt="" loading="lazy" />
            : <span className="logo placeholder">{c.name.slice(0, 2)}</span>}
          <Bilingual value={c.name} className="title" />
          {favourites.includes(c.id) && <span className="star">{"\u2605"}</span>}
          {c.quality && <span className="quality">{c.quality}</span>}
          {c.id === playingId && <span className="bars"><i /><i /><i /></span>}
        </button>
      ))}
      {!channels.length && <p className="empty">Nothing in this category.</p>}
    </div>
  );
}
