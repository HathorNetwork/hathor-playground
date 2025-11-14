/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  experimental: {
    appDir: true,
    instrumentationHook: true, // Enable instrumentation.ts loading
  },
  // Proxy removed - using Next.js API routes directly
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
      'node:events': false,
      'node:stream': false,
      'node:util': false,
      child_process: false,
      crypto: false,
      events: false,
      stream: false,
      util: false,
    };
    
    // For client-side, ignore node modules that cause issues with Pyodide and isomorphic-git
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'node:child_process': false,
        'node:crypto': false,
        'node:fs': false,
        'node:path': false,
        'node:events': false,
        'node:stream': false,
        'node:util': false,
        events: false,
        stream: false,
        util: false,
      };
    }
    
    return config;
  },
};

module.exports = nextConfig;
