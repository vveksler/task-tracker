import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Client maps for production only. Do not set webpack.devtool in `dev`:
  // Next reverts it to `false` and editor breakpoints stop binding.
  productionBrowserSourceMaps: true,
};

export default nextConfig;
