# Creates two Windows scheduled tasks that run for the current user:
#   TUSKY daily jobs    06:00   npm run jobs
#   TUSKY daily backup  05:30   npm run backup
# Run it yourself, once:   powershell -ExecutionPolicy Bypass -File ops\register-tasks.ps1
# Remove them again:       powershell -ExecutionPolicy Bypass -File ops\register-tasks.ps1 -Remove
# The computer must be on and signed in, with MySQL and Docker running.
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$tasks = @(
  @{ Name = 'TUSKY daily backup'; At = '05:30'; Args = 'ops\backup.mjs' },
  @{ Name = 'TUSKY daily jobs'; At = '06:00'; Args = 'ops\jobs.mjs' }
)

foreach ($t in $tasks) {
  if ($Remove) {
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed $($t.Name)"
    continue
  }
  $action = New-ScheduledTaskAction -Execute $node -Argument $t.Args -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -Daily -At $t.At
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Scheduled $($t.Name) at $($t.At)"
}
