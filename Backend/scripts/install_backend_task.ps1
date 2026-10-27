$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$backendPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $PSScriptRoot 'run_production.py'
$action = New-ScheduledTaskAction -Execute (Join-Path $backendPath 'venv\Scripts\pythonw.exe') -Argument ('"' + $scriptPath + '"') -WorkingDirectory $backendPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Lookahan Backend' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Waitress backend; restart on failure, start when the restaurant Windows account signs in.' -Force | Select-Object TaskName, State
