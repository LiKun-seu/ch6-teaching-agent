const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
if (basePath && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(basePath)) throw new Error("NEXT_PUBLIC_BASE_PATH 必须是 /teachdemo 这样的站内路径");

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  experimental: {
    // 允许服务端读取本地内容文件（知识库/题库）
    serverActions: { bodySizeLimit: "10mb" },
  },
  async redirects() {
    return [{ source: "/study", destination: "/", permanent: false }];
  },
};

export default nextConfig;
