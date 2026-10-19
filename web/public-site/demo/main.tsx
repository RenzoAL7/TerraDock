import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "../../src/landing/styles.css";
import { DemoPage } from "../../src/demo/DemoPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DemoPage />
  </React.StrictMode>,
);
