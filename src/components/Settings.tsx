import { useCallback, useRef, useState } from "react";
import {
  FONTS, FONT_SIZES, LANGUAGES, useSettings, type Playlist,
} from "../stores/settings";
import { useChannels } from "../stores/channels";
import { KEY, useRemote } from "../hooks/useRemote";
import { APP_VERSION, AUTHOR, REPO_URL } from "../meta";

type Section = "appearance" | "playlists" | "behaviour" | "about";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "playlists", label: "Playlists" },
  { id: "behaviour", label: "Playback" },
  { id: "about", label: "About" },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("appearance");
  const [inSections, setInSections] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Settings takes the whole remote while it is open, so App stops handling keys and
  // this owns navigation. Left and right move between the rail and the body, which is
  // the same shape as the main screen and so needs no explaining.
  const onKey = useCallback((code: number, event: KeyboardEvent) => {
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      onClose();
      return;
    }
    if (code === KEY.LEFT) {
      // Leaving a text field should not jump panes mid-edit.
      if (document.activeElement instanceof HTMLInputElement) return;
      event.preventDefault();
      setInSections(true);
      return;
    }
    if (code === KEY.RIGHT) {
      if (document.activeElement instanceof HTMLInputElement) return;
      event.preventDefault();
      setInSections(false);
      focusFirst();
      return;
    }
    if (!inSections) return;
    if (code === KEY.UP || code === KEY.DOWN) {
      event.preventDefault();
      const at = SECTIONS.findIndex((s) => s.id === section);
      const next = code === KEY.UP ? Math.max(0, at - 1) : Math.min(SECTIONS.length - 1, at + 1);
      setSection(SECTIONS[next].id);
    }
    if (code === KEY.ENTER) {
      event.preventDefault();
      setInSections(false);
      focusFirst();
    }
  }, [inSections, section, onClose]);

  const focusFirst = () => {
    window.setTimeout(() => {
      bodyRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    }, 0);
  };

  useRemote(onKey);

  return (
    <div className="sheet">
        <nav className={`sheet-rail pane ${inSections ? "focused" : ""}`}>
          <h2>Settings</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`row ${s.id === section ? "selected" : ""}`}
              onClick={() => {
                setSection(s.id);
                setInSections(false);
              }}
            >
              {s.label}
            </button>
          ))}
          <p className="sheet-lead" style={{ marginTop: "var(--s3)" }}>Return closes settings</p>
        </nav>

        <div className="sheet-body" ref={bodyRef}>
          {section === "appearance" && <Appearance />}
          {section === "playlists" && <Playlists />}
          {section === "behaviour" && <Behaviour />}
          {section === "about" && <About />}
        </div>
    </div>
  );
}

function Row({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  );
}

function Choice<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[]; value: T; onChange: (id: T) => void;
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`pill ${o.id === value ? "on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`switch ${value ? "on" : ""}`} onClick={() => onChange(!value)}>
      <span className="switch-track"><span className="switch-knob" /></span>
      <span>{value ? "On" : "Off"}</span>
    </button>
  );
}

function Appearance() {
  const s = useSettings();
  const font = s.font();
  return (
    <>
      <h3>Appearance</h3>
      <Row label="Font" hint={font.note}>
        <Choice
          options={FONTS.map((f) => ({ id: f.id, label: f.label + (f.bundled ? " \u2713" : "") }))}
          value={s.fontId}
          onChange={(id) => s.set("fontId", id)}
        />
      </Row>
      <Row label="Text size">
        <Choice options={FONT_SIZES} value={s.fontSizeId} onChange={(id) => s.set("fontSizeId", id)} />
      </Row>
      <Row label="Channel names" hint="Playlists may carry two languages">
        <Choice options={LANGUAGES} value={s.language} onChange={(id) => s.set("language", id)} />
      </Row>
      <Row label="Channel numbers"><Toggle value={s.showNumbers} onChange={(v) => s.set("showNumbers", v)} /></Row>
      <Row label="Channel logos" hint="Turn off on a slow connection">
        <Toggle value={s.showLogos} onChange={(v) => s.set("showLogos", v)} />
      </Row>
      <Row label="Clock"><Toggle value={s.showClock} onChange={(v) => s.set("showClock", v)} /></Row>
      <p className="preview" style={{ fontFamily: font.stack }}>
        Preview: IRIB TV1 &nbsp; شبکه یک &nbsp; 1234567890
      </p>
      <p className="sheet-lead">
        A tick marks a font packaged inside the app, so it works without internet.
      </p>
    </>
  );
}

function Playlists() {
  const s = useSettings();
  const { load, loading, channels } = useChannels();
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const startAdd = () => {
    setEditing({ id: "", name: "", url: "" });
    setName("");
    setUrl("");
  };
  const startEdit = (p: Playlist) => {
    setEditing(p);
    setName(p.name);
    setUrl(p.url);
  };
  const save = async () => {
    if (!url.trim()) return;
    if (editing?.id) s.updatePlaylist(editing.id, name || url, url);
    else s.addPlaylist(name || "Untitled", url);
    setEditing(null);
    await load(true);
  };

  return (
    <>
      <h3>Playlists</h3>
      <p className="sheet-lead">
        Any extended M3U works. {channels.length} channels loaded from the active one.
      </p>

      <div>
        {s.playlists.map((p) => (
          <div key={p.id} className={`pl ${p.id === s.activePlaylistId ? "active" : ""}`}>
            <button type="button" className="pl-main" onClick={async () => {
              s.set("activePlaylistId", p.id);
              await load();
            }}>
              <span className="pl-title">{p.name}</span>
              <span className="pl-url">{p.url}</span>
            </button>
            <button type="button" className="pill" onClick={() => startEdit(p)}>Edit</button>
            <button
              type="button"
              className="pill danger"
              disabled={s.playlists.length < 2}
              onClick={() => s.removePlaylist(p.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {editing ? (
        <div className="form">
          <label htmlFor="pl-name">Name</label>
          <input id="pl-name" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="My playlist" />
          <label htmlFor="pl-url">URL</label>
          <input id="pl-url" value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder="https://example.com/playlist.m3u" spellCheck={false} />
          <div className="actions">
            <button type="button" className="pill on" onClick={save}>Save</button>
            <button type="button" className="pill" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="pill" onClick={startAdd}>Add a playlist</button>
          <button type="button" className="pill" onClick={() => load(true)} disabled={loading}>
            {loading ? "Refreshing\u2026" : "Refresh now"}
          </button>
        </div>
      )}
    </>
  );
}

function Behaviour() {
  const s = useSettings();
  const { load } = useChannels();
  return (
    <>
      <h3>Playback</h3>
      <Row label="Resume the last channel" hint="Start playing it when the app opens">
        <Toggle value={s.resumeLast} onChange={(v) => s.set("resumeLast", v)} />
      </Row>
      <Row label="Sort channels A to Z" hint="Otherwise the playlist's own order is kept">
        <Toggle value={s.sortAlphabetically} onChange={async (v) => {
          s.set("sortAlphabetically", v);
          await load();
        }} />
      </Row>
      <Row label="Hide the panel after">
        <Choice
          options={[
            { id: "4", label: "4s" }, { id: "8", label: "8s" },
            { id: "15", label: "15s" }, { id: "0", label: "Never" },
          ]}
          value={String(s.panelTimeout)}
          onChange={(id) => s.set("panelTimeout", Number(id))}
        />
      </Row>
      <div className="actions">
        <button type="button" className="pill danger" onClick={() => {
          s.reset();
          void load(true);
        }}>
          Reset everything to defaults
        </button>
      </div>
    </>
  );
}

function About() {
  return (
    <>
      <h3>About</h3>
      <div className="about">
        <div>
          <h4>SimpleIPTV</h4>
          <p>Version {APP_VERSION}</p>
          <p>By {AUTHOR}</p>
          <p className="link">{REPO_URL}</p>
          <p className="sheet-lead">
            Free and open source. Scan the code to read it, report a problem, or
            contribute a playlist.
          </p>
          <p className="sheet-lead">
            Vazirmatn by Saber Rastikerdar, under the SIL Open Font License.
          </p>
        </div>
        <img className="qr" src="./repo-qr.svg" alt={`QR code linking to ${REPO_URL}`} />
      </div>
    </>
  );
}
