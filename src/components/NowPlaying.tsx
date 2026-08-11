import { useEffect, useState } from "react";
import type { Channel } from "../types";
import { Bilingual } from "./Bilingual";

/**
 * The card that confirms what was just tuned to.
 *
 * It matters more on a TV than it looks. With the panel hidden there is nothing else on
 * screen, so after a channel change the viewer has no idea whether the remote registered
 * anything until the picture appears, which on a slow stream can be several seconds.
 */
export function NowPlaying({ channel, status }: { channel: Channel; status: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 4500);
    return () => window.clearTimeout(t);
  }, [channel.id]);

  if (!visible && !status) return null;

  return (
    <div className={`now-playing ${visible || status ? "" : "fade"}`}>
      {channel.logo
        ? <img className="np-logo" src={channel.logo} alt="" />
        : <span className="np-logo placeholder">{channel.name.slice(0, 2)}</span>}
      <div className="np-text">
        <div className="np-title"><Bilingual value={channel.name} /></div>
        <div className="np-meta">
          <span className="np-number">{channel.number}</span>
          <Bilingual value={channel.group} className="np-group" />
          {channel.quality && <span className="np-quality">{channel.quality}</span>}
        </div>
      </div>
      {status && <div className="np-status">{status}</div>}
    </div>
  );
}
