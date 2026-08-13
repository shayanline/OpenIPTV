import { useState } from "react";
import { useSettings, type Playlist } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { checkPlaylistUrl, nameFromUrl } from "../../services/playlistUrl";
import { Confirm } from "../Confirm";

export function Playlists({ onAsking }: { onAsking: (asking: boolean) => void }) {
  const s = useSettings();
  const { load, loading, channels } = useChannels();
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  /** Which playlist has been asked about but not yet confirmed for removal. */
  const [confirming, setConfirming] = useState("");

  const ask = (id: string) => { setConfirming(id); onAsking(!!id); };

  const startAdd = () => {
    setEditing({ id: "", name: "", url: "" });
    setName("");
    setUrl("");
    setProblem("");
  };
  const startEdit = (p: Playlist) => {
    setEditing(p);
    setName(p.name);
    setUrl(p.url);
    setProblem("");
  };

  /**
   * Check first, then load, then say what happened.
   *
   * An address that cannot work is refused here rather than sent off to time out, and either
   * way the viewer is told the outcome: a playlist that returns nothing looks exactly like
   * one that failed if nobody says which it was.
   */
  const save = async () => {
    const verdict = checkPlaylistUrl(url);
    if (!verdict.ok) {
      setProblem(verdict.problem);
      return;
    }
    setProblem("");

    const label = name.trim() || nameFromUrl(url);
    if (editing?.id) s.updatePlaylist(editing.id, label, url.trim());
    else s.addPlaylist(label, url.trim());
    setEditing(null);

    setNote(`Loading ${label}\u2026`);
    const { count, error } = await load(true);
    setNote(error || (count > 0
      ? `${label} loaded, ${count} channels.`
      : `${label} was saved, but no channels could be read from it.`));
  };

  const refresh = async () => {
    setNote("Refreshing\u2026");
    const { count, error } = await load(true);
    setNote(error || (count > 0
      ? `Refreshed, ${count} channels.`
      : "Nothing could be read from the active playlist."));
  };

  return (
    <>
      <h3>Playlists</h3>
      {note && <p className="sheet-lead" role="status">{note}</p>}
      <p className="sheet-lead">
        Any extended M3U works. {channels.length} channels loaded from the active one.
        Playlists are stored on this device only.
      </p>
      {!s.playlists.length && (
        <p className="sheet-lead">Add one below to start watching.</p>
      )}

      <div>
        {s.playlists.map((p) => (
          <div key={p.id} className={`pl ${p.id === s.activePlaylistId ? "active" : ""}`}>
            <button type="button" className="pl-main" onClick={async () => {
              s.set("activePlaylistId", p.id);
              await load();
            }}>
              <span className="pl-title">
                {p.name}
                {/* Named, not just tinted. The accessibility guidance asks for a mark
                    alongside colour, since a tint alone says nothing in greyscale. */}
                {p.id === s.activePlaylistId && <span className="tag">Active</span>}
              </span>
              <span className="pl-url">{p.url}</span>
            </button>
            {/* Tonal rather than flat. Flat text at three metres reads as a label, not as
                something you can press, and One UI gives a medium emphasis control a grey
                fill precisely so it still looks like a control. */}
            <button type="button" className="btn tonal" onClick={() => startEdit(p)}>Edit</button>
            {/* Asked before done. Removing a playlist cannot be undone and the button sits a
                single press away from the one that plays it. */}
            <button type="button" className="btn tonal" onClick={() => ask(p.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Asked in a popup, like every other question the app puts, rather than by growing
          two more buttons inside the row being asked about. */}
      {confirming && (
        <Confirm
          title={`Remove ${s.playlists.find((p) => p.id === confirming)?.name ?? "this playlist"}?`}
          body="Its channels and the copy saved on this device go with it. The playlist itself is not touched, so it can be added again from the same address."
          confirmLabel="Remove"
          cancelLabel="Keep it"
          destructive
          onCancel={() => ask("")}
          onConfirm={() => {
            const gone = s.playlists.find((p) => p.id === confirming);
            s.removePlaylist(confirming);
            ask("");
            setNote(gone ? `Removed ${gone.name}.` : "Removed.");
            void load();
          }}
        />
      )}

      {editing ? (
        <div className="form">
          <label htmlFor="pl-name">Name</label>
          <input id="pl-name" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Taken from the address" />
          <label htmlFor="pl-url">URL</label>
          <input id="pl-url" value={url} spellCheck={false}
                 className={problem ? "wrong" : ""}
                 aria-invalid={problem ? true : undefined}
                 aria-describedby={problem ? "pl-url-problem" : undefined}
                 onChange={(e) => { setUrl(e.target.value); setProblem(""); }}
                 placeholder="https://example.com/playlist.m3u" />
          {/* Under the field it belongs to, which is where One UI puts an error, rather than
              in a popup that has to be dismissed before the mistake can be corrected. */}
          {problem && <p className="field-problem" id="pl-url-problem" role="alert">{problem}</p>}
          <div className="actions">
            {/* One filled button per screen, on the action the viewer came here to take. */}
            <button type="button" className="btn filled" onClick={save}>Save</button>
            <button type="button" className="btn tonal" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn tonal" onClick={startAdd}>Add a playlist</button>
          <button type="button" className="btn tonal" onClick={refresh} aria-busy={loading}>
            {loading ? "Refreshing\u2026" : "Refresh now"}
          </button>
        </div>
      )}
    </>
  );
}
