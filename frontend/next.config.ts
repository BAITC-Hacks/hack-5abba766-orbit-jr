import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@career-quest/backend'],
  serverExternalPackages: ['pg'],
  turbopack: { root: path.resolve(process.cwd(), '..') },
};
export default nextConfig;
