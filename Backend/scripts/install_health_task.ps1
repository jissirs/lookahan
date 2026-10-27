$ErrorActionPreference = 'Stop'
$backendPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pythonPath = Join-Path $backendPath 'venv\Scripts\pythonw.exe'
$scriptPath = Join-Path $PSScriptRoot 'check_health.py'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonPath -Argument ('"' + $scriptPath + '"') -WorkingDirectory $backendPath
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName 'Lookahan Health Monitor' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local health check every five minutes; incidents recorded in Backend/instance/logs.' -Force | Select-Object TaskName, State
