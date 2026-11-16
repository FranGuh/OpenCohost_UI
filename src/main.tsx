if (window.location.pathname === "/overlay/vrm") {
  void import("./features/avatar-vrm/bootstrap.js");
} else if (window.location.pathname === "/desktop/kira") {
  void import("./features/desktop-companion/bootstrap.js");
} else {
  void import("./shellBootstrap.js");
}