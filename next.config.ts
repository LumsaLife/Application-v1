import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Generated audio can be large; allow generous body limits on server actions.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
