import { useEffect, useState } from "react";
import type { Channel } from "../types";
import { Bilingual } from "./Bilingual";

/**
 * The banner Samsung's media player guidance describes: information about what is playing,
 * laid over the video, appearing on input and withdrawing when the viewer stops
 * interacting. It also covers the Feedback principle, since on a slow stream it is the
 * only sign the remote registered anything before the picture arrives.
 */
export function NowPlaying({ channel, status, language }: {
  channel: Channel; status: string; language: string;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, [channel.id]);

  return (
    <div className={`banner ${visible || status ? "" : "hide"}`}>
      {channel.logo
        ? <img className="banner-logo" src={channel.logo} alt="" />
        : <span className="banner-logo placeholder">{channel.name.slice(0, 2)}</span>}
      <div className="banner-text">
        <Bilingual value={channel.name} className="banner-title" language={language} />
        <div className="banner-meta">
          <span className="banner-number">{channel.number}</span>
          <Bilingual value={channel.group} language={language} />
          {channel.quality && <span>{channel.quality}</span>}
        </div>
      </div>
      {status && <div className="banner-status">{status}</div>}
    </div>
  );
}
