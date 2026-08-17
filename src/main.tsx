import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Fonts — self-hosted, no network, no FOUT.
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "./styles/tokens.css";
import "./App.css";
import "./styles/prose.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);