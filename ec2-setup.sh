#!/bin/bash

# EC2 Initial Setup Script
# Run this once on a fresh EC2 instance

set -e

echo "🔧 Setting up EC2 instance for Same Day Solution..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Update system
echo -e "${YELLOW}📦 Updating system packages...${NC}"
sudo yum update -y || sudo apt-get update -y

# Install Node.js 18.x (for Amazon Linux 2 / Ubuntu)
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Node.js 18...${NC}"
    
    # Detect OS
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    else
        OS=$(uname -s)
    fi
    
    if [ "$OS" = "amzn" ] || [ "$OS" = "amazon" ]; then
        # Amazon Linux 2
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    elif [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        # Ubuntu/Debian
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo -e "${RED}❌ Unsupported OS. Please install Node.js 18+ manually.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Node.js version: $(node -v)${NC}"
echo -e "${GREEN}✅ npm version: $(npm -v)${NC}"

# Install PM2 globally for process management
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}📦 Installing PM2...${NC}"
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 installed${NC}"
fi

# Install Git if not present
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Git...${NC}"
    if [ "$OS" = "amzn" ] || [ "$OS" = "amazon" ]; then
        sudo yum install -y git
    else
        sudo apt-get install -y git
    fi
fi

# Setup PM2 startup script
echo -e "${YELLOW}🔧 Setting up PM2 startup script...${NC}"
pm2 startup
echo -e "${GREEN}✅ PM2 startup configured${NC}"

# Create app directory if it doesn't exist
if [ ! -d "/home/ec2-user/same-day-solution" ] && [ ! -d "$HOME/same-day-solution" ]; then
    echo -e "${YELLOW}📁 Creating application directory...${NC}"
    mkdir -p ~/same-day-solution
fi

echo -e "${GREEN}✅ EC2 setup complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Clone or upload your project to the EC2 instance"
echo -e "2. Create .env file with all required environment variables"
echo -e "3. Run: chmod +x ec2-deploy.sh && ./ec2-deploy.sh"
echo ""
echo -e "${YELLOW}Required environment variables:${NC}"
echo -e "  - NEXT_PUBLIC_SUPABASE_URL"
echo -e "  - NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo -e "  - SUPABASE_SERVICE_ROLE_KEY"
echo -e "  - BBPS_API_BASE_URL"
echo -e "  - BBPS_CLIENT_ID"
echo -e "  - BBPS_CONSUMER_KEY"
echo -e "  - BBPS_CONSUMER_SECRET"
echo -e "  - RAZORPAY_KEY_ID (if using Razorpay)"
echo -e "  - RAZORPAY_KEY_SECRET (if using Razorpay)"

