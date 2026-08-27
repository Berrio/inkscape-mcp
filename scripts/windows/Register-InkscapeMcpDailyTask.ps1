[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [string]$TaskName,

  [Parameter(Mandatory)]
  [string]$RecipePath,

  [Parameter(Mandatory)]
  [string]$WorkspaceRoot,

  [Parameter(Mandatory)]
  [string]$LogPath,

  [Parameter(Mandatory)]
  [datetime]$DailyAt,

  [string]$NodePath = "node.exe",

  [string]$CliPath,

  [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CliPath)) {
  $CliPath = Join-Path $PSScriptRoot "..\..\dist\cli.js"
}

function Quote-PowerShellArgument {
  param([Parameter(Mandatory)][string]$Value)
  return "'$($Value.Replace("'", "''"))'"
}

$runner = Join-Path $PSScriptRoot "Invoke-InkscapeMcpRecipe.ps1"
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Recipe runner is missing: $runner"
}

$runnerArguments = @(
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-File",
  $runner,
  "-RecipePath",
  $RecipePath,
  "-WorkspaceRoot",
  $WorkspaceRoot,
  "-LogPath",
  $LogPath,
  "-NodePath",
  $NodePath,
  "-CliPath",
  $CliPath,
  "-NonInteractive"
)
if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
  $runnerArguments += @("-ConfigPath", $ConfigPath)
}
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  ($runnerArguments | ForEach-Object { Quote-PowerShellArgument $_ }) -join " "
)
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

if ($PSCmdlet.ShouldProcess($TaskName, "register daily Inkscape MCP recipe task")) {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Runs a local Inkscape MCP recipe without AI or stored credentials." -Force | Out-Null
}
