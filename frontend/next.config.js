/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  experimental: {
    appDir: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://backend:8000/api/:path*', // Proxy to Backend
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Monaco Editor and Pyodide need these fallbacks
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      'node:fs': false,
      'node:path': false,
      'node:child_process': false,
      'node:crypto': false,
      child_process: false,
      crypto: false,
    };
    
    // For client-side, ignore node modules that cause issues with Pyodide
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'node:child_process': false,
        'node:crypto': false,
        'node:fs': false,
        'node:path': false,
      };
    }
    
    return config;
  },
};

module.exports = nextConfig;