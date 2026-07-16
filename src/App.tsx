import { AppLayout } from "./components/AppLayout.js";
import { BackendGate } from "./components/BackendGate.js";
import { EventBridge } from "./components/EventBridge.js";
import { TitleBar } from "./components/TitleBar.js";
import { ToastProvider } from "./components/ui/Toast.js";

export function App() {
  return (
    <ToastProvider>
      {/* Frameless window (decorations:false) — TitleBar owns the top 32px and
          stays visible through the BackendGate splash so the window is always
          draggable/closable. .oc-app-body carries the height math (styles.css)
          so the 100vh app grid + gate splash fill below the bar, not past it. */}
      <div className="oc-root-shell flex flex-col">
        <TitleBar />
        <div className="oc-app-body">
          <BackendGate>
            <EventBridge />
            <AppLayout />
          </BackendGate>
        </div>
      </div>
    </ToastProvider>
  );
}
