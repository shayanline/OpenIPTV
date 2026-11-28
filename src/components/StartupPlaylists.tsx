import { useLayoutEffect, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { usePageTransition } from "../hooks/usePageTransition";
import { activeSurface, type SurfaceStack } from "../services/surfaceStack";
import { useSettings } from "../stores/settings";
import { useStartup } from "../stores/startup";
import { ExitDialog } from "./ExitDialog";
import { PlaylistShortcut } from "./PlaylistShortcut";
import { remoteVisible, SmartRemote } from "./SmartRemote";
import { ToastHost } from "./ToastHost";

export function StartupPlaylists({ onExited }: { onExited: () => void }) {
  const { direction } = useLocale();
  const playlists = useSettings((state) => state.playlists);
  const [lastActivePlaylistId] = useState(() => useSettings.getState().activePlaylist()?.id);
  const active = playlists.find((playlist) => playlist.id === lastActivePlaylistId);
  const scale = useSettings((state) => state.scale());
  const choose = useStartup((state) => state.choose);
  const pending = useStartup((state) => state.pending);
  const [showExit, setShowExit] = useState(false);
  const { phase, motion, request, onTransitionEnd } = usePageTransition<null>({
    ownerKey: "startup-playlists",
    onCommit: onExited,
  });
  useLayoutEffect(() => {
    if (pending) return;
    setShowExit(false);
    request(null, { leaving: "fade", entering: "fade" });
  }, [pending, request]);
  const stack: SurfaceStack = {
    picture: "picture",
    primary: "playlists",
    drawer: null,
    modal: showExit ? "exit" : null,
    popup: null,
  };
  const surface = activeSurface(stack);

  return (
    <div
      className={`app full-screen-page${phase !== "idle" ? " page-transition-active" : ""}`}
      dir={direction}
      data-page-transition={phase}
      data-page-fade-scope="screen"
      data-page-leave-motion={motion.leaving}
      data-page-enter-motion={motion.entering}
      data-startup-playlists
    >
      <div className="app-content" aria-hidden={showExit}>
        <PlaylistShortcut
          startup
          playlists={playlists}
          activePlaylistId={active?.id ?? ""}
          scale={scale}
          inputEnabled={pending && phase === "idle" && surface === "playlists"}
          onSelect={choose}
          onClose={() => setShowExit(true)}
          onContentFocus={() => {}}
        />
      </div>
      <div
        className="page-transition-shade"
        aria-hidden="true"
        onTransitionEnd={onTransitionEnd}
      />
      {showExit && (
        <ExitDialog onConfirm={() => setShowExit(false)} onCancel={() => setShowExit(false)} />
      )}
      <ToastHost />
      {import.meta.env.DEV && remoteVisible() && <SmartRemote />}
    </div>
  );
}
