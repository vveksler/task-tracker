import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: true,
  webpack: (config, { dev }) => {
    if (dev) {
      config.devtool = 'source-map';
    }
    return config;
  },
};

export default nextConfig;
