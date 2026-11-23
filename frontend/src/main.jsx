import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "./styles/tokens.css";
import "./browser-compat.css";
import "./responsive.css";
import "./accessibility.css";
import "./theme.css";
import "./i18n";
import { captureException } from "./utils/sentry";

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) =>
        captureException(err, { tags: { area: "service-worker", errorName: err?.name } }),
      );
    });
  } else {
    // Dev serves unhashed modules; a leftover worker would keep serving stale ones.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <HelmetProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </HelmetProvider>,
);
