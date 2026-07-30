import path from "node:path";

const projectRoot = process.cwd();

export const config = {
  port: Number(process.env.PORT || 5000),
  scanTimeoutMs: Number(process.env.SCAN_TIMEOUT_MS || 30000),
  maxRequests: Number(process.env.MAX_REQUESTS || 500),
  maxRedirects: Number(process.env.MAX_REDIRECTS || 10),
  staticFolder: path.join(projectRoot, "static"),
  pageFile: path.join(projectRoot, "templates", "index.html"),
  scannerVersion: "0.4.0-local",
};
