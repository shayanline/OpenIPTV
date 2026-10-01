import { useEffect, useState } from "react";
import {
  openPairing,
  phoneManagementState,
  startPhoneManagement,
  stopPhoneManagement,
  subscribePhoneManagement,
  type PhoneManagementState,
} from "../services/phoneServer";

export function usePhoneManagement(
  enabled: boolean,
): PhoneManagementState & { openPairing: typeof openPairing } {
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
