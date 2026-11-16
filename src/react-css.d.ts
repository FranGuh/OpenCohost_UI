import "react";

declare module "react" {
  interface CSSProperties {
    /** WebView window drag regions are not included in standard CSS typings. */
    WebkitAppRegion?: "drag" | "no-drag";
  }
}
