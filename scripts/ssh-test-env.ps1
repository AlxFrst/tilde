# Starts/stops the SSH test bench (see tests/docker/README.md). Usage: up | down | status
#
# Credentials are generated per checkout into tests\docker\keys (git-ignored): the user
# password, a key passphrase and three key pairs. Nothing secret is committed.
param([Parameter(Mandatory)][ValidateSet('up', 'down', 'status')][string]$Action)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dockerDir = Join-Path $root 'tests\docker'
$keys = Join-Path $dockerDir 'keys'
$compose = Join-Path $dockerDir 'compose.yml'

function New-Secret([string]$name) {
  $path = Join-Path $keys $name
  if (-not (Test-Path $path)) {
    $bytes = [byte[]]::new(12)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    # No trailing newline: the container reads the file verbatim.
    [IO.File]::WriteAllText($path, ([BitConverter]::ToString($bytes) -replace '-', '').ToLower())
  }
  return (Get-Content $path -Raw)
}

function New-TestKey([string]$name, [string]$type, [string]$pass, [string]$comment) {
  $path = Join-Path $keys $name
  if (-not (Test-Path $path)) {
    $bits = if ($type -eq 'rsa') { @('-b', '3072') } else { @() }
    # Passing "" through PowerShell to a native exe needs the quotes escaped.
    $passArg = if ($pass -eq '') { '""' } else { $pass }
    & ssh-keygen -q -t $type @bits -N $passArg -C $comment -f $path | Out-Null
  }
}

switch ($Action) {
  'up' {
    New-Item -ItemType Directory -Force $keys | Out-Null
    New-Secret 'password' | Out-Null
    $passphrase = New-Secret 'passphrase'
    New-TestKey 'id_ed25519' 'ed25519' '' 'tilde-test'
    New-TestKey 'id_ed25519_pass' 'ed25519' $passphrase 'tilde-test-pass'
    New-TestKey 'id_rsa' 'rsa' '' 'tilde-test-rsa'
    docker compose -f $compose up -d --build --wait
  }
  'down' { docker compose -f $compose down -v }
  'status' { docker compose -f $compose ps }
}
