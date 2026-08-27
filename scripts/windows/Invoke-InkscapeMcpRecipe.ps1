[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$RecipePath,

  [Parameter(Mandatory)]
  [string]$WorkspaceRoot,

  [Parameter(Mandatory)]
  [string]$LogPath,

  [string]$NodePath = "node.exe",

  [string]$CliPath,

  [string]$ConfigPath,

  [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($CliPath)) {
  $CliPath = Join-Path $PSScriptRoot "..\..\dist\cli.js"
}

function Resolve-ExistingPath {
  param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [ValidateSet("Container", "Leaf")]
    [string]$PathType
  )

  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType $PathType)) {
    throw "Expected a $PathType path: $Path"
  }
  return $resolved.Path
}

function Resolve-NodeExecutable {
  param([Parameter(Mandatory)][string]$Value)

  if ([System.IO.Path]::IsPathRooted($Value)) {
    return Resolve-ExistingPath -Path $Value -PathType Leaf
  }
  $command = Get-Command -Name $Value -CommandType Application -ErrorAction Stop
  return $command.Source
}

$recipe = Resolve-ExistingPath -Path $RecipePath -PathType Leaf
$workspace = Resolve-ExistingPath -Path $WorkspaceRoot -PathType Container
$cli = Resolve-ExistingPath -Path $CliPath -PathType Leaf
$node = Resolve-NodeExecutable -Value $NodePath

if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
  $config = Resolve-ExistingPath -Path $ConfigPath -PathType Leaf
}

$logDirectory = Split-Path -Parent $LogPath
if ([string]::IsNullOrWhiteSpace($logDirectory)) {
  throw "LogPath must include a parent directory"
}
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$log = [System.IO.Path]::GetFullPath($LogPath)

$arguments = @(
  $cli,
  "run",
  $recipe,
  "--workspace-root",
  $workspace
)
if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
  $arguments += @("--config", $config)
}

$mode = if ($NonInteractive) { "non-interactive" } else { "interactive-safe" }
Add-Content -LiteralPath $log -Value "[$([DateTime]::UtcNow.ToString('o'))] inkscape-mcp recipe start ($mode)"
$output = & $node @arguments 2>&1
$exitCode = $LASTEXITCODE
$output | Tee-Object -FilePath $log -Append
Add-Content -LiteralPath $log -Value "[$([DateTime]::UtcNow.ToString('o'))] inkscape-mcp recipe exit=$exitCode"

exit $exitCode
