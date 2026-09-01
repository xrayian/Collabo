/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Prevents double mounting in dev for WebRTC & Canvas connections
  allowedDevOrigins: ['host.docker.internal', 'localhost', '127.0.0.1', '192.168.0.100'],
};

export default nextConfig;
