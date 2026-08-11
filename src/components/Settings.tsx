import { useState } from "react";
import { DEFAULT_PLAYLIST, useChannels } from "../stores/channels";

export function Settings({ onClose }: { onClose: () => void }) {
  const { playlistUrl, setPlaylistUrl, load } = useChannels();
  const [value, setValue] = useState(playlistUrl);

  const apply = async () => {
    setPlaylistUrl(value.trim() || DEFAULT_PLAYLIST);
    await load(true);
    onClose();
  };

  return (
    <div className="settings">
      <div className="panel">
        <h2>Settings</h2>
        <label htmlFor="playlist">Playlist URL</label>
        <input
          id="playlist"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
        <div className="row">
          <button type="button" onClick={apply}>Save and reload</button>
          <button type="button" onClick={() => setValue(DEFAULT_PLAYLIST)}>Reset</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <p className="note">
          Any extended M3U works. The default is the iptv-iran list.
        </p>
      </div>
    </div>
  );
}
