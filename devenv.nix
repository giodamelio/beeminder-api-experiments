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
    # Bubble Tea's init() queries the terminal background (OSC 11) on every run and the late
    # reply leaks into the shell; buzz never uses the result, so drop the file holding that init()
    preBuild = ''
      chmod u+w vendor/github.com/charmbracelet/bubbletea
      rm vendor/github.com/charmbracelet/bubbletea/tea_init.go
    '';
    nativeBuildInputs = [pkgs.makeWrapper];
    # buzz only reads ~/.buzzrc, so point HOME at the repo to use the config rendered there
    postInstall = ''
      wrapProgram $out/bin/buzz --run 'export HOME="$DEVENV_ROOT"'
    '';
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
  env.BEEMINDER_USERNAME = config.secretspec.secrets.BEEMINDER_USERNAME or "";

  # Rendered at shell entry from env vars rather than in Nix so the token isn't copied into another store path
  enterShell = ''
    (umask 077 && ${pkgs.jq}/bin/jq -n \
      --arg username "$BEEMINDER_USERNAME" \
      --arg auth_token "$BEEMINDER_API_TOKEN" \
      '{username: $username, auth_token: $auth_token}' > "$DEVENV_ROOT/.buzzrc")
  '';

  # Headless chromium renders graph text with no glyphs unless fontconfig can find a font
  env.FONTCONFIG_FILE = pkgs.makeFontsConf {fontDirectories = [pkgs.dejavu_fonts];};

  # Some setup for Hurl so you can just run the files directly
  env.HURL_SECRET_token = config.secretspec.secrets.BEEMINDER_API_TOKEN or "";
  env.HURL_VARIABLE_user = config.secretspec.secrets.BEEMINDER_USERNAME or "";
  env.HURL_VARIABLE_goal = "unread-emails";
}
