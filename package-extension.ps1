# Requires PowerShell 5.1+
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $ScriptDir

$OutDir = 'dist'
$ArchiveName = 'download-organizer.zip'
$ArchivePath = Join-Path -Path $OutDir -ChildPath $ArchiveName

if (-not (Test-Path -Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

if (Test-Path -Path $ArchivePath) {
    Remove-Item -Path $ArchivePath -Force
}

$Excludes = @(
    '.git',
    'dist',
    'package-extension.sh',
    'package-extension.ps1',
    'AGENTS.md'
)

$Entries = Get-ChildItem -Force | Where-Object { $Excludes -notcontains $_.Name }

if (-not $Entries) {
    Write-Error 'No files found to package.'
    exit 1
}

Compress-Archive -Path ($Entries | ForEach-Object { $_.FullName }) -DestinationPath $ArchivePath -Force

Write-Host "Packaged extension at $ArchivePath"
