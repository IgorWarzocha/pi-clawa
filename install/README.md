# Project install files

`pi-settings.json` is the project-local Pi settings file used by the installer script.
It loads the Clawa environment package from npm into the current project, not the global Pi config.

The shell installer writes it to `.pi/settings.json` in the caller's current directory.
It also sets `sessionDir` to `.pi/sessions`, so main Clawa session history stays inside the project home.
