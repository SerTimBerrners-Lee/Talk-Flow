!macro TALKIS_TERMINATE_PROCESS IMAGE_NAME
  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /T /IM "${IMAGE_NAME}"'
  Pop $R8
  Pop $R9
!macroend

!macro TALKIS_STOP_RUNNING_APP
  !insertmacro TALKIS_TERMINATE_PROCESS "Talkis.exe"
  !insertmacro TALKIS_TERMINATE_PROCESS "talkis-stt.exe"
  !insertmacro TALKIS_TERMINATE_PROCESS "talkis-diarize.exe"
  !insertmacro TALKIS_TERMINATE_PROCESS "talkis-llm.exe"
  !insertmacro TALKIS_TERMINATE_PROCESS "talkis-ffmpeg.exe"
  Sleep 750
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TALKIS_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TALKIS_STOP_RUNNING_APP
!macroend
