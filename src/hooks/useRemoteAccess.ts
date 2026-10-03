import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => subscribeRemoteAccess(setState), []);
  useEffect(() => {
    if (enabled && development) void startDevelopmentRemoteAccess();
    else if (enabled) startRemoteAccess();
    else void stopRemoteAccess();
    return () => {
      if (enabled) void stopRemoteAccess();
    };
  }, [enabled, development]);

  const retry = useCallback(() => {
    void stopRemoteAccess().then(() => {
      if (development) void startDevelopmentRemoteAccess();
      else startRemoteAccess();
    });
  }, [development]);

  return { ...state, openPairing, cancelPairing, retry };
}
