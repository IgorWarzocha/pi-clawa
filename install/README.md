# Project install files

`pi-settings.json` is the project-local Pi settings file used by the installer script.
It loads the Clawa package into the current project, not the global Pi config.

The shell installer writes it to `.pi/settings.json` in the caller's current directory.
Main Clawa sessions stay in Pi's normal session store so `pi -c` and `pi -r` work normally.
