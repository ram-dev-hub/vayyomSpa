$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtimeDir = Join-Path $projectRoot '.local'
$mysqlBase = Join-Path $runtimeDir 'mysql-8.4.9-winx64'
$mysqlExe = Join-Path $mysqlBase 'bin\mysqld.exe'
$mysqlClient = Join-Path $mysqlBase 'bin\mysql.exe'
$dataDir = Join-Path $runtimeDir 'mysql-data'
$configPath = Join-Path $runtimeDir 'mysql.ini'
if (-not (Test-Path -LiteralPath $mysqlExe)) { throw 'Extract official mysql-8.4.9-winx64.zip into .local first. See README.' }
if (Test-Path -LiteralPath (Join-Path $projectRoot '.env')) { throw '.env already exists. Setup will not overwrite your configuration. Use scripts/start-local.ps1.' }
if (Test-Path -LiteralPath $dataDir) { throw 'MySQL data directory already exists. Setup will not overwrite existing data.' }
$listener = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw 'Port 3306 is already in use. Configure .env to use your existing MySQL server.' }
function New-LocalSecret {
 $bytes = New-Object byte[] 32
 $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
 $rng.GetBytes($bytes)
 $rng.Dispose()
 return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}
$dbPassword = New-LocalSecret
$rootPassword = New-LocalSecret
$adminPassword = New-LocalSecret
$jwtSecret = New-LocalSecret
$baseForward = $mysqlBase.Replace('\','/')
$dataForward = $dataDir.Replace('\','/')
$configText = "[mysqld]`nbasedir=$baseForward`ndatadir=$dataForward`nbind-address=127.0.0.1`nport=3306`nmysqlx=OFF`ncharacter-set-server=utf8mb4`ncollation-server=utf8mb4_unicode_ci`n"
[IO.File]::WriteAllText($configPath,$configText)
& $mysqlExe "--defaults-file=$configPath" --initialize-insecure --console
if ($LASTEXITCODE -ne 0) { throw 'MySQL initialization failed' }
$dbProcess = Start-Process -FilePath $mysqlExe -ArgumentList @("--defaults-file=`"$configPath`"") -WindowStyle Hidden -PassThru
$dbProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeDir 'mysql.pid')
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
 try { $tcp = New-Object Net.Sockets.TcpClient('127.0.0.1',3306); $tcp.Close(); $ready=$true; break } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw 'MySQL did not start. Check .local/mysql-data/*.err' }
$sql = "ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPassword'; CREATE DATABASE vayyom_spa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'vayyom'@'localhost' IDENTIFIED BY '$dbPassword'; GRANT ALL PRIVILEGES ON vayyom_spa.* TO 'vayyom'@'localhost';"
$sql | & $mysqlClient --host=127.0.0.1 --user=root --batch
if ($LASTEXITCODE -ne 0) { throw 'MySQL database/user setup failed' }
$envText = "DATABASE_URL=`"mysql://vayyom:$dbPassword@127.0.0.1:3306/vayyom_spa`"`nJWT_SECRET=`"$jwtSecret`"`nPORT=4000`nWEB_ORIGIN=http://localhost:5173`nSEED_ADMIN_PASSWORD=`"$adminPassword`"`nNOTIFICATION_WEBHOOK_URL=`nNOTIFICATION_WEBHOOK_TOKEN=`n"
[IO.File]::WriteAllText((Join-Path $projectRoot '.env'),$envText)
[IO.File]::WriteAllText((Join-Path $runtimeDir 'mysql-admin.ini'),"[client]`nhost=127.0.0.1`nuser=root`npassword=$rootPassword`n")
Write-Output 'MySQL is running on 127.0.0.1:3306. Database vayyom_spa and .env created.'
Write-Output 'Admin username: admin. Password is the SEED_ADMIN_PASSWORD value in .env.'
