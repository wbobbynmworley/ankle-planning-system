/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // exFAT/部分非 NTFS 盘不支持符号链接，生产构建时 webpack 的 readlink 会报 EISDIR；
  // 本项目依赖未使用符号链接，关闭符号链接解析即可（对 Linux 部署无副作用）。
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
  async redirects() {
    return [
      { source: '/dashboard/preop/2d', destination: '/dashboard/preop', permanent: false },
      { source: '/dashboard/preop/3d', destination: '/dashboard/preop', permanent: false },
      { source: '/dashboard/postop/2d', destination: '/dashboard/postop', permanent: false },
      { source: '/dashboard/postop/3d', destination: '/dashboard/postop', permanent: false },
    ];
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return [
      { source: '/api', destination: `${apiBase}/api` },
      { source: '/api/:path*', destination: `${apiBase}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
