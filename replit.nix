{pkgs}: {
  deps = [
    pkgs.postgresql
    pkgs.geckodriver
    pkgs.firefox-esr
    pkgs.chromium
    pkgs.zip
  ];
}
