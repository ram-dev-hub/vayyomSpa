$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtimeDir = Join-Path $projectRoot '.local'
if (-not (Test-Path -LiteralPath '.env')) { throw 'Configure .env first. See README.' }
if (-not (Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue)) {
 $mysqlExe = Join-Path $runtimeDir 'mysql-8.4.9-winx64\bin\mysqld.exe'
 $configPath = Join-Path $runtimeDir 'mysql.ini'
 if (-not (Test-Path -LiteralPath $configPath)) { throw 'Start your local MySQL server before starting the application.' }
 $process = Start-Process -FilePath $mysqlExe -ArgumentList @("--defaults-file=`"$configPath`"") -WindowStyle Hidden -PassThru
 $process.Id | Set-Content -LiteralPath (Join-Path $runtimeDir 'mysql.pid')
}
npm.cmd run dev
