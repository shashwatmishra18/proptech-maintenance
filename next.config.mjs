/** @type {import('next').NextConfig} */
// Private attachments must never enter the shared image-optimizer cache.
const nextConfig = { images: { unoptimized: true } };

export default nextConfig;
