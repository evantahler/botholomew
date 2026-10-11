import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Local primitives and the shared product token engine.
import "./styles/theme.scss";
// Fixed midnight density plus the specialized Studio layouts.
import "./styles/studio.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
