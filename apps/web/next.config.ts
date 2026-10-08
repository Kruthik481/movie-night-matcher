import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@mnm/shared'],
  // Tailwind v4 runs as a Turbopack loader (from the create-next-app template); without it @theme and utilities never compile
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
};

export default nextConfig;
