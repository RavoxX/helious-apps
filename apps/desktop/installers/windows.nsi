Unicode True
!include "MUI2.nsh"
Name "Helious"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Helious"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "..\assets\icons\icon.ico"
UninstallIcon "..\assets\icons\icon.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Helious"
VIAddVersionKey "FileDescription" "Helious native installer"
VIAddVersionKey "FileVersion" "${VERSION}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Helious.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Helious"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /oname=Helious.exe "${APP_EXE}"
  File /oname=THIRD-PARTY-NOTICES.txt "${NOTICES}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Helious.lnk" "$INSTDIR\Helious.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "DisplayName" "Helious"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "Publisher" "Helious"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious" "DisplayIcon" "$INSTDIR\Helious.exe"
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Helious.lnk"
  Delete "$INSTDIR\Helious.exe"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Helious"
  ; User vaults, registry.json and OS credentials are deliberately retained.
SectionEnd
