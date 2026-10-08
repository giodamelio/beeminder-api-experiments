{
  pkgs,
  lib,
  config,
  inputs,
  ...
}: let
  buzz = pkgs.buildGoModule rec {
    pname = "buzz";
    version = "0.86.1";
    src = pkgs.fetchFromGitHub {
      owner = "PinePeakDigital";
      repo = "buzz";
      rev = "v${version}";
      hash = "sha256-vcpWT+vkEODnYNRBytytmAprj1ccXc1Sd3Oq8p0eidA=";
    };
    vendorHash = "sha256-Y6veZo7L54eA+y1hMTGKqMVoUamFpnIb+yzPi6eqo3M=";
    ldflags = ["-s" "-w" "-X main.version=${version}"];
    doCheck = false;
  };
in {
  packages = with pkgs; [
    buzz
    hurl
    ungoogled-chromium
  ];

  languages.javascript = {
    enable = true;
    bun = {
      enable = true;
      install.enable = true;
    };
  };
  languages.typescript = {
    enable = true;
    lsp.enable = true;
  };

  env.BEEMINDER_API_TOKEN = config.secretspec.secrets.BEEMINDER_API_TOKEN or "";

  # Headless chromium renders graph text with no glyphs unless fontconfig can find a font
  env.FONTCONFIG_FILE = pkgs.makeFontsConf {fontDirectories = [pkgs.dejavu_fonts];};

  # Some setup for Hurl so you can just run the files directly
  env.HURL_SECRET_token = config.secretspec.secrets.BEEMINDER_API_TOKEN or "";
  env.HURL_VARIABLE_user = "giodamelio";
  env.HURL_VARIABLE_goal = "unread-emails";
}
