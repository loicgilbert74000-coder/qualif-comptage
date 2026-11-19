import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// The static spinner in index.html is only there to cover the gap before
// this point — the app itself already shows its own "Chargement…" states
// wherever it still needs to fetch something.
document.getElementById("initial-loader")?.remove();
