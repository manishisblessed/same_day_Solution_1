# # CloudFront Cache Invalidation Script
# # This script invalidates CloudFront cache to show latest deployment

# param(
#     [Parameter(Mandatory=$false)]
#     [string]$DistributionId = "",
    
#     [Parameter(Mandatory=$false)]
#     [string]$Paths = "/*"
# )

# # Check if AWS CLI is installed
# if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
#     Write-Host "❌ AWS CLI is not installed or not in PATH" -ForegroundColor Red
#     Write-Host "Install from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
#     exit 1
# }

# # If Distribution ID not provided, try to find it
# if ([string]::IsNullOrEmpty($DistributionId)) {
#     Write-Host "🔍 Searching for CloudFront distribution with domain 'samedaysolution.in'..." -ForegroundColor Yellow
    
#     $DistributionId = aws cloudfront list-distributions `
#         --query "DistributionList.Items[?contains(Aliases.Items, 'samedaysolution.in')].Id" `
#         --output text
    
#     if ([string]::IsNullOrEmpty($DistributionId)) {
#         Write-Host "❌ Could not find CloudFront distribution for 'samedaysolution.in'" -ForegroundColor Red
#         Write-Host "Please provide Distribution ID manually:" -ForegroundColor Yellow
#         Write-Host "  .\invalidate-cloudfront.ps1 -DistributionId 'YOUR_DISTRIBUTION_ID'" -ForegroundColor Cyan
#         exit 1
#     }
    
#     Write-Host "✅ Found distribution: $DistributionId" -ForegroundColor Green
# }

# Write-Host ""
# Write-Host "Creating CloudFront invalidation..." -ForegroundColor Yellow
# Write-Host "  Distribution ID: $DistributionId" -ForegroundColor Cyan
# Write-Host "  Paths: $Paths" -ForegroundColor Cyan
# Write-Host ""

# # Create invalidation
# try {
#     $result = aws cloudfront create-invalidation `
#         --distribution-id $DistributionId `
#         --paths $Paths `
#         --output json 2>&1
    
#     if ($LASTEXITCODE -eq 0) {
#         $invalidation = $result | ConvertFrom-Json
#         $invalidationId = $invalidation.Invalidation.Id
#         $status = $invalidation.Invalidation.Status
        
#         Write-Host "✅ Invalidation created successfully!" -ForegroundColor Green
#         Write-Host "  Invalidation ID: $invalidationId" -ForegroundColor Cyan
#         Write-Host "  Status: $status" -ForegroundColor Cyan
#         Write-Host ""
#         Write-Host "⏳ Waiting for invalidation to complete..." -ForegroundColor Yellow
#         Write-Host "   (This usually takes 1-5 minutes)" -ForegroundColor Gray
        
#         # Poll for completion
#         $startTime = Get-Date
#         $timeout = New-TimeSpan -Minutes 10
        
#         do {
#             Start-Sleep -Seconds 10
            
#             $statusResult = aws cloudfront get-invalidation `
#                 --distribution-id $DistributionId `
#                 --id $invalidationId `
#                 --output json 2>&1
            
#             if ($LASTEXITCODE -eq 0) {
#                 $statusData = $statusResult | ConvertFrom-Json
#                 $currentStatus = $statusData.Invalidation.Status
                
#                 $elapsed = (Get-Date) - $startTime
#                 Write-Host "  Status: $currentStatus (Elapsed: $($elapsed.ToString('mm\:ss')))" -ForegroundColor Cyan
                
#                 if ($currentStatus -eq "Completed") {
#                     Write-Host ""
#                     Write-Host "✅ Invalidation completed successfully!" -ForegroundColor Green
#                     Write-Host "   Your latest deployment should now be visible at:" -ForegroundColor Yellow
#                     Write-Host "   https://samedaysolution.in/admin" -ForegroundColor Cyan
#                     exit 0
#                 }
#             }
            
#             $elapsed = (Get-Date) - $startTime
#             if ($elapsed -gt $timeout) {
#                 Write-Host ""
#                 Write-Host "⏱️  Timeout reached. Invalidation may still be in progress." -ForegroundColor Yellow
#                 Write-Host "   Check status in AWS Console: https://console.aws.amazon.com/cloudfront/" -ForegroundColor Cyan
#                 exit 0
#             }
#         } while ($true)
#     } else {
#         Write-Host "❌ Failed to create invalidation" -ForegroundColor Red
#         Write-Host $result -ForegroundColor Red
#         exit 1
#     }
# } catch {
#     Write-Host "❌ Error: $_" -ForegroundColor Red
#     exit 1
# }



# CloudFront Cache Invalidation Script
# This script invalidates CloudFront cache to show latest deployment

param(
    [Parameter(Mandatory=$false)]
    [string]$DistributionId = "",
    
    [Parameter(Mandatory=$false)]
    [string[]]$Paths = @("/*")
)

# Check if AWS CLI is installed
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "❌ AWS CLI is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Install from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# If Distribution ID not provided, try to find it
if ([string]::IsNullOrEmpty($DistributionId)) {
    Write-Host "🔍 Searching for CloudFront distribution with domain 'samedaysolution.in'..." -ForegroundColor Yellow
    
    $DistributionId = aws cloudfront list-distributions `
        --query "DistributionList.Items[?contains(Aliases.Items, 'samedaysolution.in')].Id" `
        --output text
    
    if ([string]::IsNullOrEmpty($DistributionId)) {
        Write-Host "❌ Could not find CloudFront distribution for 'samedaysolution.in'" -ForegroundColor Red
        Write-Host "Please provide Distribution ID manually:" -ForegroundColor Yellow
        Write-Host "  .\invalidate-cloudfront.ps1 -DistributionId 'YOUR_DISTRIBUTION_ID'" -ForegroundColor Cyan
        exit 1
    }
    
    Write-Host "✅ Found distribution: $DistributionId" -ForegroundColor Green
}

Write-Host ""
Write-Host "Creating CloudFront invalidation..." -ForegroundColor Yellow
Write-Host "  Distribution ID: $DistributionId" -ForegroundColor Cyan
Write-Host "  Paths: $($Paths -join ', ')" -ForegroundColor Cyan
Write-Host ""

try {
    $result = aws cloudfront create-invalidation `
        --distribution-id $DistributionId `
        --paths $Paths `
        --output json

    if ($LASTEXITCODE -eq 0) {
        $invalidation = $result | ConvertFrom-Json
        $invalidationId = $invalidation.Invalidation.Id
        $status = $invalidation.Invalidation.Status
        
        Write-Host "✅ Invalidation created successfully!" -ForegroundColor Green
        Write-Host "  Invalidation ID: $invalidationId" -ForegroundColor Cyan
        Write-Host "  Status: $status" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "⏳ Waiting for invalidation to complete..." -ForegroundColor Yellow
        Write-Host "   (This usually takes 1-5 minutes)" -ForegroundColor Gray

        # Poll for completion
        $startTime = Get-Date
        $timeout = New-TimeSpan -Minutes 10
        
        do {
            Start-Sleep -Seconds 10
            
            $statusResult = aws cloudfront get-invalidation `
                --distribution-id $DistributionId `
                --id $invalidationId `
                --output json 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                $statusData = $statusResult | ConvertFrom-Json
                $currentStatus = $statusData.Invalidation.Status
                
                $elapsed = (Get-Date) - $startTime
                Write-Host "  Status: $currentStatus (Elapsed: $($elapsed.ToString('mm\:ss')))" -ForegroundColor Cyan
                
                if ($currentStatus -eq "Completed") {
                    Write-Host ""
                    Write-Host "✅ Invalidation completed successfully!" -ForegroundColor Green
                    Write-Host "   Your latest deployment should now be visible at:" -ForegroundColor Yellow
                    Write-Host "   https://samedaysolution.in/admin" -ForegroundColor Cyan
                    exit 0
                }
            }
            
            $elapsed = (Get-Date) - $startTime
            if ($elapsed -gt $timeout) {
                Write-Host ""
                Write-Host "⏱️  Timeout reached. Invalidation may still be in progress." -ForegroundColor Yellow
                Write-Host "   Check status in AWS Console: https://console.aws.amazon.com/cloudfront/" -ForegroundColor Cyan
                exit 0
            }
        } while ($true)
    } else {
        Write-Host "❌ Failed to create invalidation" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
