$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot
node scripts/start-all.mjs
exit $LASTEXITCODE
