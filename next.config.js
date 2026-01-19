/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    // Allow images from the same domain
    remotePatterns: [],
    // Configure image domains
    domains: [],
    // Enable image optimization (default)
    unoptimized: false,
    // Add custom domains for image optimization
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  // Disable strict mode in production if causing issues
  reactStrictMode: true,
  // Ensure proper static generation
  generateBuildId: async () => {
    // Use git commit hash or timestamp for build ID
    return process.env.BUILD_ID || `build-${Date.now()}`
  },
  // Ensure proper trailing slash handling
  trailingSlash: false,
  // Webpack configuration to ensure path aliases work correctly and optimize performance
  webpack: (config, { isServer }) => {
    // Ensure path aliases are resolved correctly
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname),
    }
    
    // Optimize webpack cache for better performance
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Vendor chunk for node_modules
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Common chunk for shared code
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
            },
          },
        },
      }
    }
    
    return config
  },
  // Note: Content-Type headers are handled by middleware.ts
  // This allows file upload routes (multipart/form-data) to work correctly
}

module.exports = nextConfig

