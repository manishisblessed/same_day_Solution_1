#!/bin/bash

# EC2 Deployment Script for Same Day Solution
# This script builds and starts the Next.js application on EC2

set -e  # Exit on error

echo "🚀 Starting EC2 Deployment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+ first.${NC}"
    exit 1
fi

# Check Node.js version (should be 18+)
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version 18+ is required. Current version: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js version: $(node -v)${NC}"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ npm version: $(npm -v)${NC}"

# Check if .env file exists
if [ ! -f .env.local ] && [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  Warning: No .env or .env.local file found.${NC}"
    echo -e "${YELLOW}   Make sure to set environment variables.${NC}"
fi

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm ci --production=false

# Build the application
echo -e "${YELLOW}🔨 Building Next.js application...${NC}"
NODE_OPTIONS="--max-old-space-size=4096" npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful!${NC}"
else
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

# Check if PM2 is installed (for process management)
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}✅ PM2 is installed${NC}"
    echo -e "${YELLOW}🔄 Restarting application with PM2...${NC}"
    
    # Stop existing process if running
    pm2 stop same-day-solution 2>/dev/null || true
    pm2 delete same-day-solution 2>/dev/null || true
    
    # Start the application
    pm2 start npm --name "same-day-solution" -- start
    pm2 save
    
    echo -e "${GREEN}✅ Application started with PM2${NC}"
    echo -e "${GREEN}📊 Run 'pm2 status' to check application status${NC}"
    echo -e "${GREEN}📋 Run 'pm2 logs same-day-solution' to view logs${NC}"
else
    echo -e "${YELLOW}⚠️  PM2 is not installed. Starting application directly...${NC}"
    echo -e "${YELLOW}   Consider installing PM2 for better process management:${NC}"
    echo -e "${YELLOW}   npm install -g pm2${NC}"
    echo ""
    echo -e "${GREEN}✅ Starting application...${NC}"
    npm start
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"

