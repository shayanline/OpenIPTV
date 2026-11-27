import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "./useLocale";
import { useToast } from "./useToast";
import type { PairingSessionView } from "../services/deviceAccess";
import {
  cancelPairing,
  openPairing,
  remoteAccessState,
  startDevelopmentRemoteAccess,
  startRemoteAccess,
  stopRemoteAccess,
  subscribeRemoteAccess,
  type RemoteAccessState,
} from "../services/remoteServer";

export type RemoteAccessControl = RemoteAccessState & {
  openPairing: () => PairingSessionView | null;
  cancelPairing: () => void;
  retry: () => void;
};

export function useRemoteAccess(enabled: boolean, development = false): RemoteAccessControl {
  const [state, setState] = useState(remoteAccessState);
  const { t } = useLocale();
  const notifications = useToast("remote-access", enabled);
  const lifecycle = useRef(0);

  useEffect(() => subscribeRemoteAccess(setState), []);
  useEffect(() => {
    lifecycle.current += 1;
    if (enabled && development) void startDevelopmentRemoteAccess();
    else if (enabled) startRemoteAccess();
    else void stopRemoteAccess();
    return () => {
      lifecycle.current += 1;
      if (enabled) void stopRemoteAccess();
    };
  }, [enabled, development]);

  useEffect(() => {
    if (!enabled) return;
    if (state.status === "unavailable") {
      notifications.show(
        [t("remote.unavailable"), state.error].filter(Boolean).join(" "),
        "error",
      );
    } else if (state.pairingError) {
      notifications.show(t("remote.pairingFailed"), "error");
    }
  }, [enabled, notifications.show, state.status, state.error, state.pairingError, t]);

  const retry = useCallback(() => {
    if (!enabled) return;
    const generation = ++lifecycle.current;
    void stopRemoteAccess().then(() => {
      if (lifecycle.current !== generation) return;
      if (development) void startDevelopmentRemoteAccess();
      else startRemoteAccess();
    });
  }, [enabled, development]);

  return { ...state, openPairing, cancelPairing, retry };
}
