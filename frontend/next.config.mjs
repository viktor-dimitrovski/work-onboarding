const rawBackendBase = process.env.BACKEND_API_URL || 'http://127.0.0.1:8000';
// On Windows, "localhost" may resolve to ::1 first, while the backend is bound to IPv4.
// Normalizing to 127.0.0.1 avoids intermittent ECONNREFUSED ::1 issues.
const backendBase = rawBackendBase.replace(/:\/\/localhost(?=[:/]|$)/, '://127.0.0.1');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendBase}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
