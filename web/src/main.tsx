import "@fontsource/sofia-sans/400.css";
import "@fontsource/sofia-sans/500.css";
import "@fontsource/sofia-sans/600.css";
import "@fontsource/sofia-sans/700.css";
import "@fontsource/sofia-sans-extra-condensed/700.css";
import "@fontsource/sofia-sans-extra-condensed/800.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
