# winget manifest

`manifests/d/donlapidos/DesktopBuddy/0.4.0/` holds the three files winget needs (version, installer, default
locale, schema 1.9.0), laid out the way [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) expects.
Submit them only after the v0.4.0 release is published: winget downloads the installer from the release.

## 1. Fill in the installer's checksum

Once the release is published, in PowerShell from the repository folder:

```powershell
$url = 'https://github.com/donlapidos/desktop-buddy/releases/download/v0.4.0/Desktop-Buddy-Setup-0.4.0.exe'
$exe = Join-Path $env:TEMP 'Desktop-Buddy-Setup-0.4.0.exe'
Invoke-WebRequest $url -OutFile $exe
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash
$file = 'packaging\winget\manifests\d\donlapidos\DesktopBuddy\0.4.0\donlapidos.DesktopBuddy.installer.yaml'
(Get-Content $file -Raw).Replace('<fill from the released installer>', $sha) | Set-Content $file -Encoding utf8 -NoNewline
$sha
```

Hash the file downloaded from the release, not one from `dist/`: a local build is a different file.

## 2. Check it

```powershell
winget validate --manifest packaging\winget\manifests\d\donlapidos\DesktopBuddy\0.4.0
winget settings --enable LocalManifestFiles   # once, in an administrator PowerShell
winget install --manifest packaging\winget\manifests\d\donlapidos\DesktopBuddy\0.4.0
```

## 3. Submit

With [wingetcreate](https://github.com/microsoft/winget-create) (`winget install Microsoft.WingetCreate`) and a
GitHub token that can fork repositories:

```powershell
wingetcreate submit --token <github token> packaging\winget\manifests\d\donlapidos\DesktopBuddy\0.4.0
```

Or by hand: fork microsoft/winget-pkgs, copy the folder to `manifests/d/donlapidos/DesktopBuddy/0.4.0/`, and open a
pull request. Microsoft's checks run on the pull request; an unsigned installer is accepted but may be held for
a manual SmartScreen review.

For later versions, `wingetcreate update donlapidos.DesktopBuddy --version <x.y.z> --urls <installer url> --submit`
writes and submits the new manifest from the one already in winget.
