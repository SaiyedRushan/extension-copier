import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No StrictMode: its doubled effects in development would open every store page twice.
createRoot(document.getElementById("root")!).render(<App />);
