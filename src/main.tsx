import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/barlow-condensed/900.css";
import "./styles/index.css";
import { applyTheme } from "./core/theme";
import App from "./shell/App";

applyTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
