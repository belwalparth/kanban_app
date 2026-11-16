const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig = {
  output: isDevelopment ? undefined : "export",
  reactStrictMode: true,
  ...(isDevelopment ? {
    async rewrites() {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
    },
  } : {}),
};

export default nextConfig;
