[Setup]
AppName=AuraSplit
AppVersion=3.0.0
DefaultDirName={localappdata}\Programs\AuraSplit_v3
DefaultGroupName=AuraSplit
OutputBaseFilename=AuraSplit_v3_Installer
OutputDir=.
Compression=lzma2
SolidCompression=yes
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\AuraSplit.exe
PrivilegesRequired=lowest
DisableDirPage=no

[Files]
Source: "release\0.0.0\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\AuraSplit"; Filename: "{app}\AuraSplit.exe"
Name: "{autodesktop}\AuraSplit"; Filename: "{app}\AuraSplit.exe"

[Run]
Filename: "{app}\AuraSplit.exe"; Description: "Khởi chạy AuraSplit"; Flags: nowait postinstall skipifsilent
