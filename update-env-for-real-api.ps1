# PowerShell script to update .env.local to use real BBPS API

$envFile = ".env.local"
$content = Get-Content $envFile -Raw

# Replace USE_BBPS_MOCK=true with USE_BBPS_MOCK=false
$content = $content -replace 'USE_BBPS_MOCK=true', 'USE_BBPS_MOCK=false'

# Ensure BBPS credentials are uncommented for localhost
# (They're already set for EC2, but we need them for localhost too)

# Write back to file
$content | Set-Content $envFile -NoNewline

Write-Host "✅ Updated .env.local to disable mock mode"
Write-Host "📝 Please verify your BBPS credentials are set correctly"
Write-Host "🔄 Restart your dev server: npm run dev"

