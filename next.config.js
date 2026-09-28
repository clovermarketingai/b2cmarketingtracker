/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The tracker lives at /daily. pages/index.js is a stale Closing Tracker copy
  // whose API routes do not exist here, so the root must never be the landing
  // page: this also covers the post-login redirect to "/".
  async redirects() {
    return [{ source: '/', destination: '/daily', permanent: false }];
  },
};

module.exports = nextConfig;
