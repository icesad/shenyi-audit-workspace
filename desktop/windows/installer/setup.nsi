Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor zlib
CRCCheck force
!include "MUI2.nsh"
!include "x64.nsh"
!define TITLE "审迹工作台（内测）"
!define VERSION_TITLE "${TITLE} ${BUILD_ID}"
!define ARP "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShenyiWorkbenchPreview-${BUILD_ID}"
!define ACTIVE "Software\Shenyi\WorkbenchLocalReviewInstaller"
!define ROOT "$LOCALAPPDATA\Programs\ShenyiWorkbenchPreview"
!define APP "${ROOT}\${BUILD_ID}"
!define CURRENT_LINK "$SMPROGRAMS\${TITLE}.lnk"
!define VERSIONS_MENU "$SMPROGRAMS\审迹工作台内测版本"

Name "${TITLE}"
OutFile "${OUTPUT}"
InstallDir "${APP}"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "${TITLE}"
VIAddVersionKey /LANG=2052 "FileDescription" "审迹六模块本机体验版安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "审迹工作台内测版。第三方组件遵循随附许可。"

!define MUI_WELCOMEPAGE_TITLE "安装审迹工作台（内测）"
!define MUI_WELCOMEPAGE_TEXT "供负责人在本机核对六个业务模块，请使用测试资料。程序安装到当前 Windows 用户的目录，业务数据保存在独立的体验工作区。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro LockMaintenance
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\ShenyiWorkbenchPreviewMaintenance") p.r8 ?e'
  Pop $9
  StrCmp $8 0 busy
  StrCmp $9 183 busy ready
  busy:
    MessageBox MB_OK|MB_ICONEXCLAMATION "另一个安装或卸载任务正在进行，请稍后重试。" /SD IDOK
    Abort
  ready:
!macroend

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此体验版需要 64 位 Windows。" /SD IDOK
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
  StrCpy $INSTDIR "${APP}"
  !insertmacro LockMaintenance
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  StrCmp $INSTDIR "${APP}" valid
    MessageBox MB_OK|MB_ICONSTOP "请从 Windows 已安装的应用或原安装目录卸载此版本。" /SD IDOK
    Abort
  valid:
  !insertmacro LockMaintenance
FunctionEnd

Section "审迹工作台"
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${PAYLOAD}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  IfErrors failed
  ClearErrors
  CreateDirectory "${VERSIONS_MENU}"
  CreateShortcut "${VERSIONS_MENU}\${VERSION_TITLE}.lnk" "$INSTDIR\ShenyiWorkbench.exe"
  CreateShortcut "${CURRENT_LINK}" "$INSTDIR\ShenyiWorkbench.exe"
  WriteRegStr HKCU "${ARP}" "DisplayName" "${VERSION_TITLE}"
  WriteRegStr HKCU "${ARP}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${ARP}" "DisplayIcon" "$INSTDIR\ShenyiWorkbench.exe"
  WriteRegStr HKCU "${ARP}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${ARP}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${ARP}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${ARP}" "NoModify" 1
  WriteRegDWORD HKCU "${ARP}" "NoRepair" 1
  WriteRegStr HKCU "${ACTIVE}" "ActiveBuild" "${BUILD_ID}"
  IfErrors failed done
  failed:
    SetErrorLevel 2
    Abort "安装未完成，请关闭正在使用的体验版后重试。"
  done:
SectionEnd

Section "Uninstall"
  ; Stop before removing any payload if Windows still has the main executable open.
  SetOutPath "$TEMP"
  IfFileExists "$INSTDIR\ShenyiWorkbench.exe" 0 removeFiles
  ClearErrors
  Delete "$INSTDIR\ShenyiWorkbench.exe"
  IfErrors busy
  removeFiles:
  !include "${REMOVE_PAYLOAD}"
  Delete "${VERSIONS_MENU}\${VERSION_TITLE}.lnk"
  RMDir "${VERSIONS_MENU}"
  ReadRegStr $0 HKCU "${ACTIVE}" "ActiveBuild"
  StrCmp $0 "${BUILD_ID}" 0 retainCurrent
  Delete "${CURRENT_LINK}"
  DeleteRegValue HKCU "${ACTIVE}" "ActiveBuild"
  DeleteRegKey /ifempty HKCU "${ACTIVE}"
  retainCurrent:
  DeleteRegKey HKCU "${ARP}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  RMDir "${ROOT}"
  Goto finished
  busy:
    SetErrorLevel 2
    Abort "请先关闭此版本的审迹工作台，再重新卸载。"
  finished:
SectionEnd
