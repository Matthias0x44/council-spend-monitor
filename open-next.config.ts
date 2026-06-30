import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default Cloudflare config for the Next.js app. We don't yet need any of
// OpenNext's caching backends (no ISR / on-demand revalidation in the UI),
// so the minimal definition is enough. Add cache/queue/incremental adapters
// later if we start using `revalidatePath` / `revalidateTag`.
export default defineCloudflareConfig({});
