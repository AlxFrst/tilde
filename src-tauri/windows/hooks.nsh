; Tilde writes "Ouvrir dans Tilde" into Explorer's context menu itself (for the current
; user, see src-tauri/src/explorer_menu.rs); the uninstaller removes it.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Tilde"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Tilde"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Tilde"
!macroend
