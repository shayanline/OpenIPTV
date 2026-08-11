import { useEffect, useRef } from "react";
import type { Channel } from "../types";
import { Bilingual } from "./Bilingual";
import { ScrollIndicator } from "./ScrollIndicator";

interface Props {
  channels: Channel[];
  index: number;
  focused: boolean;
  playingId: string;
  favourites: string[];
  loading: boolean;
  showNumbers: boolean;
  showLogos: boolean;
  language: string;
  onSelect: (channel: Channel, index: number) => void;
}

export function ChannelList({
  channels, index, focused, playingId, favourites, loading,
  showNumbers, showLogos, language, onSelect,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLButtonElement>(null);

  // Moving focus, in Samsung's terms: the list holds still and the highlight travels,
  // scrolling only when the selection would otherwise leave the view.
  useEffect(() => {
    row.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className={`list pane ${focused ? "focused" : ""}`}>
      <p className="panel-title">Channels</p>
      <div className="list-scroll" ref={scroller}>
        {loading && !channels.length
          ? Array.from({ length: 8 }, (_, i) => (
              <div className="row" key={i}>
                <span className="sk sk-logo" />
                <span className="sk sk-title" />
              </div>
            ))
          : channels.map((c, i) => (
              <button
                key={c.id}
                ref={i === index ? row : undefined}
                type="button"
                className={`row ${i === index ? "selected" : ""}`}
                onClick={() => onSelect(c, i)}
              >
                {showNumbers && <span className="ch-number muted">{c.number}</span>}
                {showLogos && (c.logo
                  ? <img className="ch-logo" src={c.logo} alt="" loading="lazy" />
                  : <span className="ch-logo placeholder">{c.name.slice(0, 2)}</span>)}
                <Bilingual value={c.name} className="ch-name" language={language} />
                {favourites.includes(c.id) && <span className="ch-star">{"\u2605"}</span>}
                {c.quality && <span className="ch-badge muted">{c.quality}</span>}
                {c.id === playingId && <span className="playing-dot" title="Playing" />}
              </button>
            ))}
        {!loading && !channels.length && <p className="empty">Nothing in this category.</p>}
      </div>
      <ScrollIndicator target={scroller} deps={[index, channels.length]} />
    </div>
  );
}
