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

  # Some setup for Hurl so you can just run the files directly
  env.HURL_SECRET_token = config.secretspec.secrets.BEEMINDER_API_TOKEN or "";
  env.HURL_VARIABLE_user = "giodamelio";
  env.HURL_VARIABLE_goal = "unread-emails";
}
