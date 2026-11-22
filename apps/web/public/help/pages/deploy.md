# Deploy to an organisation (for IT)

This page is for IT teams rolling redcolumn out to many computers. It covers:

- installing the Windows app silently, for one person or for everyone on a computer
- a managed policy that turns features off, such as automatic updates and the MCP server, and that people cannot change

Managed policy applies to the desktop app. The web app in a browser does not read it.

## Silent install on Windows

The installer is **redcolumn-Setup.exe** from the [latest release](https://github.com/ColbyGallagher/redcolumn/releases/latest). Run it with these switches:

| Switch | What it does |
|---|---|
| `/S` | Installs with no windows and no questions. |
| `/allusers` | Installs for everyone on the computer, in Program Files. Needs administrator rights. |
| `/currentuser` | Installs for the person running it only, in their profile. This is what `/S` alone does. |
| `/D=folder` | Installs into *folder*. It must come last, with no quotes, even when the folder has spaces. |

For everyone on the computer, from a deployment tool that runs as SYSTEM or an administrator (Intune, Configuration Manager, a startup script):

```
redcolumn-Setup.exe /S /allusers
```

Into a folder of your choice:

```
redcolumn-Setup.exe /S /allusers /D=C:\Program Files\redcolumn
```

For one person, with no administrator rights needed:

```
redcolumn-Setup.exe /S
```

The app goes into `C:\Program Files\redcolumn` for everyone, or `%LOCALAPPDATA%\Programs\redcolumn` for one person. Start menu shortcuts and the PDF "Open with" entry are added either way. redcolumn never makes itself the default PDF app.

To uninstall silently:

```
"C:\Program Files\redcolumn\Uninstall redcolumn.exe" /S /allusers
"%LOCALAPPDATA%\Programs\redcolumn\Uninstall redcolumn.exe" /S
```

> **Important:** Choose one kind of install per computer. Don't install for one person on a computer that already has it for everyone, or the other way round.

### Intune and other tools

- **Install command:** `redcolumn-Setup.exe /S /allusers`, install behaviour **System**.
- **Uninstall command:** `"C:\Program Files\redcolumn\Uninstall redcolumn.exe" /S /allusers`
- **Detection:** the file `C:\Program Files\redcolumn\redcolumn.exe` exists, with its file version at least the version you deploy.
- **Updating:** run the newer installer with the same switches. Documents, markups and preferences are kept.

The installer is not signed. If your computers only run signed software, allow it by its hash or add your own signature before you deploy it.

### Updates on managed computers

The app checks for a new release when it starts and, on Windows, downloads and installs it when it closes. An install for everyone needs administrator rights to update, so people without them see a Windows prompt they cannot approve. For installs you manage, turn automatic updates off with the policy below and deploy each new version yourself.

### macOS

Deploy the app from **redcolumn-arm64.dmg** (Apple Silicon) or **redcolumn-x64.dmg** (Intel) with your management tool, copying **redcolumn.app** into `/Applications`. There is no silent installer package. The app is not signed with a Developer ID, so allow it in your management tool.

## Managed policy

A policy turns features off for everyone on a computer. The app reads it once when it starts, so changes take effect the next time redcolumn opens. Policy only ever turns things off. Everything not listed stays as it is.

### Where the app looks

| Where | What |
|---|---|
| Windows registry | `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\redcolumn`. Set it with Group Policy (the template below), Intune or any configuration tool. |
| Windows file | `C:\ProgramData\redcolumn\policy.json` |
| macOS file | `/Library/Application Support/redcolumn/policy.json` |
| Linux file | `/etc/redcolumn/policy.json` |

Use the registry on Windows where you can. Only administrators can change it, and it does not depend on the person's environment.

When there is more than one source, **the most restrictive wins**. A feature is off if any source turns it off. The disabled features are every source's list put together. No source can turn back on something another one turns off.

### Policy settings

| Setting | Turns off |
|---|---|
| `DisableAutoUpdate` | Update checks, downloads and installs. {{Help > Check for Updates}} and the update button are hidden. |
| `DisableAssistant` | The MCP server, so AI clients on the computer cannot reach redcolumn. It stays off even if the person turned it on before, and the switch in [Preferences](#preferences) › **MCP** is locked. |
| `DisableCommunityLibrary` | {{Tools > Browse Library…}}, which lists and downloads trade packs from the public library on GitHub. |
| `DisableMicrosoftSignIn` | Microsoft sign-in and everything that needs it: OneDrive Projects and Live Sessions, and profile backup to OneDrive. Folders on the computer still work. |
| `DisableExcelSync` | Sync to Excel on this computer, which drives Excel on Windows. |
| `DisabledFeatures` | The commands you list, by ID. |

In the registry, each switch is a **REG_DWORD**: `1` turns the feature off and `0` leaves it on. In the JSON file it is `true` or `false`.

The redcolumn app turns off the switched features itself: no update check is made, the MCP server does not listen, and sign-in and library requests are refused even if something in the app asked for them.

### Turn off individual commands

`DisabledFeatures` takes command IDs. [Every command](#mcp-command-list) lists them all, for example `help.sponsor`, `tools.library` or `file.migrateRevu`. End an ID with `.*` to turn off a whole group: `takeoff.*` turns off every Takeoff command.

A command turned off is gone from the menus, the ribbon, the buttons at the top of the window, the command palette and menu search. Its keyboard shortcut does nothing, and the MCP server neither lists it nor runs it. A few panels have buttons of their own that are not commands. Use a switch above to turn off a whole area.

In the registry, list the IDs either:

- as a **REG_MULTI_SZ** value named `DisabledFeatures`, one ID per line, or
- as string values under the key `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\redcolumn\DisabledFeatures`, named `1`, `2`, `3` and so on. This is what the Group Policy template writes.

### Example: registry

From an administrator command prompt:

```
reg add "HKLM\SOFTWARE\Policies\redcolumn" /v DisableAutoUpdate /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\redcolumn" /v DisableAssistant /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\redcolumn" /v DisabledFeatures /t REG_MULTI_SZ /d "help.sponsor\0file.migrateRevu" /f
```

### Example: policy file

`C:\ProgramData\redcolumn\policy.json`:

```
{
  "version": 1,
  "disableAutoUpdate": true,
  "disableAssistant": true,
  "disableCommunityLibrary": false,
  "disableMicrosoftSignIn": false,
  "disableExcelSync": false,
  "disabledFeatures": ["help.sponsor", "file.migrateRevu"]
}
```

Set the file so only administrators can change it. On Windows, `C:\ProgramData` lets everyone create files, so create the `redcolumn` folder yourself and give standard users read access only.

### Group Policy template

`redcolumn.admx` and `en-US\redcolumn.adml` are in the [docs/admin](https://github.com/ColbyGallagher/redcolumn/tree/master/docs/admin) folder of the repository. Copy them into your Group Policy central store (`\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions`) or `C:\Windows\PolicyDefinitions`. The settings are under **Computer Configuration** › **Administrative Templates** › **redcolumn**.

### Check what a computer is using

- [Preferences](#preferences) shows **Managed by your organisation.** at the top, with what is turned off.
- {{Help > Send Log Files}} saves a log that lists the policy in use and anything wrong with it.

### Mistakes in a policy

- A setting the app does not know is ignored, and noted in the log. A newer policy works with an older app.
- A switch with the wrong kind of value, such as the text `"true"` in the file or a REG_SZ in the registry, counts as **on**.
- A policy file that is not valid JSON, or cannot be read, turns **every** switch on until it is fixed. A policy only exists because you meant to restrict the app, so a mistake never turns anything back on. Opening and marking up PDFs is never affected.
- A command ID with characters a command ID cannot have is ignored and noted in the log.

Policy controls the installed app. It does not stop someone running a copy of redcolumn they install themselves. To control that, use application control such as AppLocker or Windows Defender Application Control.
