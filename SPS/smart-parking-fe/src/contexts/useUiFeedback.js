import { useContext } from "react";
import { UiFeedbackContext } from "./UiFeedbackContext.jsx";

export function useUiFeedback() {
  const context = useContext(UiFeedbackContext);
  if (!context) {
    throw new Error("useUiFeedback must be used within UiFeedbackProvider");
  }
  return context;
}
