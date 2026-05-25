import React from "react";
import ReactDOM from "react-dom/client";
import "tldraw/tldraw.css";
import "./styles/index.css";
import "./styles.css";
import { App } from "./ui/App.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

