import type { NextConfig } from 'next';

const config: NextConfig = {
  // The game is a single client-rendered canvas: no server, deploys as static files.
  output: 'export',
  reactStrictMode: true,
};

export default config;
