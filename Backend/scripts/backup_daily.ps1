$ErrorActionPreference = 'Stop'
$backendPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectPath = Split-Path $backendPath -Parent
$backupPath = Join-Path (Split-Path $projectPath -Parent) 'lookahan-backups\daily'
$logPath = Join-Path $backendPath 'instance\logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null
Push-Location $backendPath
try {
    & (Join-Path $backendPath 'venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'backup_database.py') --directory $backupPath *>> (Join-Path $logPath 'backup.log')
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; see instance/logs/backup.log' }
} finally { Pop-Location }
