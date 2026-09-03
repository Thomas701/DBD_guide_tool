import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Élément #root introuvable");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }, { once: true });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
