import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AccountApp } from "./features/account/AccountApp.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Élément #root introuvable");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(__APP_BUILD_ID__)}`).catch(() => undefined);
  }, { once: true });
}

createRoot(root).render(
  <StrictMode>
    <AccountApp />
  </StrictMode>
);
