import { AppLayout } from "./components/AppLayout.js";
import { BackendGate } from "./components/BackendGate.js";
import { ToastProvider } from "./components/ui/Toast.js";

export function App() {
  return (
    <ToastProvider>
      <BackendGate>
        <AppLayout />
      </BackendGate>
    </ToastProvider>
  );
}
