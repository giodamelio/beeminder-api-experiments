{
  pkgs,
  lib,
  config,
  inputs,
  ...
}: {
  packages = with pkgs; [
    hurl
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
}
