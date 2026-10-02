/** @type {import('next').NextConfig} */
// Private attachments must never enter the shared image-optimizer cache.
const nextConfig = {
    output: 'standalone',
    images: { unoptimized: true },
    // bcrypt loads native binaries dynamically, beyond automatic tracing.
    experimental: {
        outputFileTracingIncludes: {
            '/api/auth/*': ['./node_modules/bcrypt/prebuilds/**/*'],
        },
    },
};

export default nextConfig;
