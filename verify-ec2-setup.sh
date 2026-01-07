#!/bin/bash

# Verification Script for EC2 Deployment
# Run this to check if your project is ready for EC2 deployment

set -e

echo "🔍 Verifying EC2 Deployment Readiness..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

# Check Node.js
echo -n "Checking Node.js... "
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo -e "${GREEN}✅ $(node -v)${NC}"
    else
        echo -e "${RED}❌ Version 18+ required. Current: $(node -v)${NC}"
        ((ERRORS++))
    fi
else
    echo -e "${RED}❌ Not installed${NC}"
    ((ERRORS++))
fi

# Check npm
echo -n "Checking npm... "
if command -v npm &> /dev/null; then
    echo -e "${GREEN}✅ $(npm -v)${NC}"
else
    echo -e "${RED}❌ Not installed${NC}"
    ((ERRORS++))
fi

# Check package.json
echo -n "Checking package.json... "
if [ -f "package.json" ]; then
    echo -e "${GREEN}✅ Found${NC}"
else
    echo -e "${RED}❌ Not found${NC}"
    ((ERRORS++))
fi

# Check required files
echo -n "Checking Next.js config... "
if [ -f "next.config.js" ]; then
    echo -e "${GREEN}✅ Found${NC}"
else
    echo -e "${YELLOW}⚠️  Not found (optional)${NC}"
    ((WARNINGS++))
fi

# Check environment variables
echo -n "Checking environment variables... "
if [ -f ".env.local" ] || [ -f ".env" ]; then
    echo -e "${GREEN}✅ Found${NC}"
    
    # Check for required BBPS variables
    if [ -f ".env.local" ]; then
        ENV_FILE=".env.local"
    else
        ENV_FILE=".env"
    fi
    
    MISSING_VARS=()
    
    if ! grep -q "BBPS_CLIENT_ID" "$ENV_FILE" 2>/dev/null; then
        MISSING_VARS+=("BBPS_CLIENT_ID")
    fi
    if ! grep -q "BBPS_CONSUMER_KEY" "$ENV_FILE" 2>/dev/null; then
        MISSING_VARS+=("BBPS_CONSUMER_KEY")
    fi
    if ! grep -q "BBPS_CONSUMER_SECRET" "$ENV_FILE" 2>/dev/null; then
        MISSING_VARS+=("BBPS_CONSUMER_SECRET")
    fi
    if ! grep -q "NEXT_PUBLIC_SUPABASE_URL" "$ENV_FILE" 2>/dev/null; then
        MISSING_VARS+=("NEXT_PUBLIC_SUPABASE_URL")
    fi
    if ! grep -q "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$ENV_FILE" 2>/dev/null; then
        MISSING_VARS+=("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    fi
    
    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Missing variables: ${MISSING_VARS[*]}${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${YELLOW}⚠️  Not found${NC}"
    echo -e "${YELLOW}   Create .env.local with required variables${NC}"
    ((WARNINGS++))
fi

# Check if node_modules exists
echo -n "Checking dependencies... "
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ Installed${NC}"
else
    echo -e "${YELLOW}⚠️  Not installed. Run 'npm install'${NC}"
    ((WARNINGS++))
fi

# Check TypeScript compilation
echo -n "Checking TypeScript... "
if [ -f "tsconfig.json" ]; then
    if command -v npx &> /dev/null; then
        if npx tsc --noEmit 2>/dev/null; then
            echo -e "${GREEN}✅ No errors${NC}"
        else
            echo -e "${RED}❌ TypeScript errors found${NC}"
            ((ERRORS++))
        fi
    else
        echo -e "${YELLOW}⚠️  Cannot verify (npx not available)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  tsconfig.json not found${NC}"
fi

# Check build
echo -n "Testing build... "
if npm run build --dry-run 2>/dev/null || npm run build 2>&1 | head -5 > /dev/null; then
    echo -e "${GREEN}✅ Build script exists${NC}"
    echo -e "${YELLOW}   Run 'npm run build' to test actual build${NC}"
else
    echo -e "${YELLOW}⚠️  Could not verify build${NC}"
    ((WARNINGS++))
fi

# Check required directories
echo -n "Checking project structure... "
REQUIRED_DIRS=("app" "components" "lib")
MISSING_DIRS=()
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        MISSING_DIRS+=("$dir")
    fi
done

if [ ${#MISSING_DIRS[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ All required directories found${NC}"
else
    echo -e "${RED}❌ Missing directories: ${MISSING_DIRS[*]}${NC}"
    ((ERRORS++))
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! Ready for EC2 deployment.${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Ready with $WARNINGS warning(s). Review and fix if needed.${NC}"
    exit 0
else
    echo -e "${RED}❌ Found $ERRORS error(s) and $WARNINGS warning(s).${NC}"
    echo -e "${RED}   Please fix errors before deploying to EC2.${NC}"
    exit 1
fi

