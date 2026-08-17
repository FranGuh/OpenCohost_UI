import { AppLayout } from "./features/shell/AppLayout.js";
import { BackendGate } from "./features/shell/BackendGate.js";
import { EventBridge } from "./features/shell/EventBridge.js";
import { FirstRunGate } from "./features/shell/FirstRunGate.js";
import { TitleBar } from "./features/shell/TitleBar.js";
import { ToastProvider } from "./ui/Toast.js";

export function App() {
  return (
    <ToastProvider>
      {/* Frameless window (decorations:false) — the merged TitleBar owns the top
          40px (brand + status cluster + window controls) and stays mounted above
          the BackendGate so the window is always draggable/closable, even during
          boot. AppLayout portals the status/gear cluster into the bar once it
          mounts past the gate. .oc-app-body carries the height math (styles.css)
          so the app grid + gate splash fill below the bar, not past it. */}
      <div className="oc-root-shell flex flex-col">
        <TitleBar />
        <div className="oc-app-body">
          <BackendGate runtimeSetup={(onReady, backendError) => <FirstRunGate onReady={onReady} backendError={backendError} />}>
            <EventBridge />
            <AppLayout />
          </BackendGate>
        </div>
      </div>
    </ToastProvider>
  );
}
