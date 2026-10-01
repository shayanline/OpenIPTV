import { useEffect, useState } from "react";
import type { PairingSessionView } from "../services/phoneAccess";
import {
  openPairing,
  phoneManagementState,
  startPhoneManagement,
  stopPhoneManagement,
  subscribePhoneManagement,
  type PhoneManagementState,
} from "../services/phoneServer";

export type PhoneManagementControl = PhoneManagementState & {
  openPairing: () => PairingSessionView;
};

export function usePhoneManagement(enabled: boolean): PhoneManagementControl {
  const [state, setState] = useState(phoneManagementState);

  useEffect(() => subscribePhoneManagement(setState), []);
  useEffect(() => {
    if (enabled) startPhoneManagement();
    else void stopPhoneManagement();
    return () => {
      if (enabled) void stopPhoneManagement();
    };
  }, [enabled]);

  return { ...state, openPairing };
}
