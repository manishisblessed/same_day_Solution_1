/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production optimizations
  poweredByHeader: false, // Remove X-Powered-By header for security
  compress: true, // Enable gzip compression
  swcMinify: true, // Use SWC minifier (faster than Terser)
  
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
  
  // Enable React strict mode for better development experience
  reactStrictMode: true,
  
  // Ensure proper static generation
  generateBuildId: async () => {
    // Use git commit hash or timestamp for build ID
    return process.env.BUILD_ID || `build-${Date.now()}`
  },
  
  // Ensure proper trailing slash handling
  trailingSlash: false,
  
  // Production environment variables validation
  env: {
    // These are validated at runtime, but we can document them here
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  
  // Output configuration for production
  output: 'standalone', // Enable standalone output for better Docker/container support
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

