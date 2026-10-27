$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'backup_daily.ps1'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"')
$trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Lookahan Daily Database Backup' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Verified local MySQL snapshot at 03:00; runs when this user is signed in.' -Force | Select-Object TaskName, State
