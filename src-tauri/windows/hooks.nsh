; Danish Fitness installer hooks (included by Tauri's NSIS template).
;
; Updates (a new installer run over an existing install) never touch the gym data: Tauri runs the old
; uninstaller with /UPDATE, which skips everything below.
;
; A real uninstall first saves a copy of the database - in Documents\Danish Fitness\Backups and in the folder
; the app last backed up to (e.g. D:\Danish Fitness\Backups) - so the data survives even when someone ticks
; "Delete the application data". The copies show up in the app's backup list and on the first-run screen.

!macro DF_SAVE_DATABASE_COPY TARGET_DIR
  CreateDirectory "${TARGET_DIR}"
  CopyFiles /SILENT "$APPDATA\${BUNDLEID}\danish-fitness.db" "${TARGET_DIR}\danish-fitness_$R2-$R1-$R0_$R4-$R5-$R6_uninstall.db"
  ; Changes not yet merged into the main file (if the app did not close normally) travel with the copy.
  ${If} ${FileExists} "$APPDATA\${BUNDLEID}\danish-fitness.db-wal"
    CopyFiles /SILENT "$APPDATA\${BUNDLEID}\danish-fitness.db-wal" "${TARGET_DIR}\danish-fitness_$R2-$R1-$R0_$R4-$R5-$R6_uninstall.db-wal"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ; The database must not be in use while it is copied (the template checks again afterwards).
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    SetShellVarContext current
    ${If} ${FileExists} "$APPDATA\${BUNDLEID}\danish-fitness.db"
      ; $R0 day, $R1 month, $R2 year, $R4 hour, $R5 minute, $R6 second (local time)
      ${GetTime} "" "L" $R0 $R1 $R2 $R3 $R4 $R5 $R6
      !insertmacro DF_SAVE_DATABASE_COPY "$DOCUMENTS\Danish Fitness\Backups"

      ; The app records its backup folder in backup-folder.txt (UTF-16LE, one line).
      ClearErrors
      FileOpen $R7 "$APPDATA\${BUNDLEID}\backup-folder.txt" r
      ${IfNot} ${Errors}
        FileReadUTF16LE $R7 $R8
        FileClose $R7
        ${If} $R8 != ""
        ${AndIf} $R8 != "$DOCUMENTS\Danish Fitness\Backups"
          !insertmacro DF_SAVE_DATABASE_COPY "$R8"
        ${EndIf}
      ${EndIf}
      DetailPrint "A copy of the gym data was saved in Documents\Danish Fitness\Backups"
    ${EndIf}
  ${EndIf}
!macroend
