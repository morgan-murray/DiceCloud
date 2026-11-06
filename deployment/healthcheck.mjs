import { rootConfiguration } from './urlPaths.mjs';
try {
  const { basePath } = rootConfiguration(process.env.ROOT_URL);
  const response = await fetch(`http://127.0.0.1:3000${basePath}api/status`);
  process.exit(response.ok ? 0 : 1);
} catch { process.exit(1); }
