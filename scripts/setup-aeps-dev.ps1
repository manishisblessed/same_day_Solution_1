# AEPS + MFS110 Environment Setup Script (Windows PowerShell)
#
# This script helps you set up your development environment for AEPS testing
# with the MFS110 biometric device for real transactions.
#
# Usage: .\scripts\setup-aeps-dev.ps1
#
# If you get "execution policy" error, run:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

param(
    [switch]$Verbose = $false
)

# Enable VerbosePreference if -Verbose is passed
if ($Verbose) {
    $VerbosePreference = "Continue"
}

$ErrorActionPreference = "Stop"

# Colors and formatting
$Blue = @{ ForegroundColor = 'Cyan' }
$Green = @{ ForegroundColor = 'Green' }
$Yellow = @{ ForegroundColor = 'Yellow' }
$Red = @{ ForegroundColor = 'Red' }
$Separator = "========================================`n"

# Helper functions
function Write-Title {
    param([string]$Title)
    Write-Host "`n$Separator" @Blue
    Write-Host $Title @Blue
    Write-Host $Separator @Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" @Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ $Message" @Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" @Red
}

function Write-Step {
    param([string]$Step)
    Write-Host "→ $Step" @Yellow
}

# Main script
Write-Host "`n"
Write-Title "AEPS + MFS110 Dev Setup"

# Check if Node.js is installed
Write-Step "Checking Node.js..."
try {
    $nodeVersion = node --version
    Write-Success "Node.js $nodeVersion"
} catch {
    Write-Error "Node.js not found. Please install Node.js 18+"
    exit 1
}

# Check if npm is installed
Write-Step "Checking npm..."
try {
    $npmVersion = npm --version
    Write-Success "npm $npmVersion"
} catch {
    Write-Error "npm not found. Please install npm"
    exit 1
}

# Check if .env.local exists
Write-Step "Checking environment configuration..."
if (-not (Test-Path ".env.local")) {
    Write-Warning ".env.local not found. Creating from .env.example..."
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env.local"
        Write-Success "Created .env.local"
        Write-Warning "IMPORTANT: Edit .env.local and add your Chagans credentials:"
        Write-Host "  - AEPS_USE_MOCK=false"
        Write-Host "  - CHAGHANS_AEPS_CLIENT_ID=..."
        Write-Host "  - CHAGHANS_AEPS_CONSUMER_SECRET=..."
        Write-Host "  - CHAGHANS_AEPS_AUTH_TOKEN=..."
    } else {
        Write-Error ".env.example not found"
        exit 1
    }
} else {
    Write-Success ".env.local exists"
}

# Check .env.local in .gitignore
Write-Step "Checking .gitignore..."
$gitignoreContent = Get-Content ".gitignore" -ErrorAction SilentlyContinue
if ($gitignoreContent -match "\.env\.local") {
    Write-Success ".env.local is in .gitignore"
} else {
    Write-Warning "Adding .env.local to .gitignore"
    Add-Content ".gitignore" ".env.local"
    Write-Success "Added to .gitignore"
}

# Check if node_modules exists
Write-Step "Checking dependencies..."
if (-not (Test-Path "node_modules")) {
    Write-Warning "Installing dependencies (this may take a few minutes)..."
    npm install
    Write-Success "Dependencies installed"
} else {
    Write-Success "Dependencies already installed"
}

# Check scripts directory
Write-Step "Checking scripts..."
if (Test-Path "scripts\aeps-test-util.js") {
    Write-Success "AEPS testing utility found"
} else {
    Write-Warning "AEPS testing utility not found"
}

# Check documentation
Write-Step "Checking documentation..."
$docsCount = 0
$docsList = @()

if (Test-Path "AEPS-QUICK-REFERENCE.md") {
    Write-Success "Quick Reference found"
    $docsCount++
    $docsList += "AEPS-QUICK-REFERENCE.md"
}

if (Test-Path "AEPS-MFS110-DEV-TESTING.md") {
    Write-Success "Full Testing Guide found"
    $docsCount++
    $docsList += "AEPS-MFS110-DEV-TESTING.md"
}

if (Test-Path "AEPS-DEV-SETUP-CHECKLIST.md") {
    Write-Success "Setup Checklist found"
    $docsCount++
    $docsList += "AEPS-DEV-SETUP-CHECKLIST.md"
}

if (Test-Path "MFS110-BIOMETRIC-INTEGRATION.md") {
    Write-Success "Biometric Integration Guide found"
    $docsCount++
    $docsList += "MFS110-BIOMETRIC-INTEGRATION.md"
}

if ($docsCount -eq 0) {
    Write-Warning "Documentation not found"
} else {
    Write-Success "Found $docsCount documentation files"
}

# Check Supabase configuration
Write-Step "Checking Supabase configuration..."
$envContent = Get-Content ".env.local"
if ($envContent -match "NEXT_PUBLIC_SUPABASE_URL") {
    Write-Success "Supabase URL configured"
} else {
    Write-Warning "Supabase URL not configured"
}

# Create .env.dev.local for development
Write-Step "Creating development environment override..."
$envDevContent = @"
# Development environment overrides
# This file is not committed and is used when running "npm run dev"

# DEBUG=aeps:*
# Uncomment above for detailed AEPS logging

# MFS110 Configuration (adjust to your setup)
MFS110_RD_SERVICE_URL=http://localhost:8000
MFS110_CAPTURE_TIMEOUT=30000
MFS110_QUALITY_THRESHOLD=50

# API Logging
NEXT_PUBLIC_LOG_LEVEL=debug
"@

$envDevContent | Out-File ".env.dev.local" -Encoding UTF8
Write-Success "Created .env.dev.local"

# Final summary
Write-Title "Setup Summary"

Write-Host ""
Write-Success "Setup completed!"
Write-Host ""

Write-Warning "Next Steps:"
Write-Host "  1. Edit .env.local with your Chagans credentials"
Write-Host "  2. Verify MFS110 device and RD Service setup"
Write-Host "  3. Run: npm run dev"
Write-Host "  4. Test: node scripts\aeps-test-util.js check-config"
Write-Host ""

Write-Warning "Documentation:"
foreach ($doc in $docsList) {
    switch ($doc) {
        "AEPS-QUICK-REFERENCE.md" { Write-Host "  📄 Quick Start: $doc" }
        "AEPS-DEV-SETUP-CHECKLIST.md" { Write-Host "  ✓ Setup Checklist: $doc" }
        "AEPS-MFS110-DEV-TESTING.md" { Write-Host "  📖 Full Guide: $doc" }
        "MFS110-BIOMETRIC-INTEGRATION.md" { Write-Host "  🔐 Biometric Integration: $doc" }
    }
}

Write-Host ""
Write-Warning "Testing Commands:"
Write-Host "  • Config Check: node scripts\aeps-test-util.js check-config"
Write-Host "  • Get Banks: node scripts\aeps-test-util.js check-banks MERCHANT_ID"
Write-Host "  • Interactive: node scripts\aeps-test-util.js"
Write-Host ""

Write-Success "✨ Ready to test AEPS with MFS110!"
Write-Host "`n"

# Optional: Offer to open Visual Studio Code
$openCode = Read-Host "Would you like to open this project in VS Code? (y/n)"
if ($openCode -eq "y") {
    code .
}

# Optional: Offer to start dev server
$startDev = Read-Host "Would you like to start the dev server? (y/n)"
if ($startDev -eq "y") {
    Write-Host "`nStarting dev server..."
    Write-Host "Press Ctrl+C to stop when done"
    npm run dev
}
