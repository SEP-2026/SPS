import { useOutletContext } from "react-router-dom";

export function useAdminContext() {
  return useOutletContext() ?? {};
}
