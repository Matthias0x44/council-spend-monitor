/**
 * Generic file discovery for council spending data.
 *
 * Two strategies:
 *   A) data.gov.uk CKAN API — returns direct download URLs with metadata
 *   B) HTML page scraping — follows links on a transparency page
 */

import * as cheerio from "cheerio";

export interface DiscoveredFile {
  url: string;
  filename: string;
  format: string; // csv, xlsx, xls
  modified?: string; // ISO date if available
}

export interface CouncilConfig {
  slug: string;
  name: string;
  transparencyUrl?: string | null;
  dataGovId?: string | null;
  filePattern?: string | null; // regex string for filtering links
}

// ---------------------------------------------------------------------------
// Strategy A: data.gov.uk CKAN API
// ---------------------------------------------------------------------------

interface CkanResource {
  url: string;
  name: string;
  format: string;
  last_modified: string | null;
  created: string | null;
}

interface CkanPackageShow {
  success: boolean;
  result: {
    resources: CkanResource[];
  };
}

export async function discoverViaCkan(
  dataGovId: string
): Promise<DiscoveredFile[]> {
  const apiUrl = `https://data.gov.uk/api/action/package_show?id=${encodeURIComponent(dataGovId)}`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`CKAN API error ${res.status} for ${dataGovId}`);
  }

  const data = (await res.json()) as CkanPackageShow;
  if (!data.success) throw new Error(`CKAN returned success=false for ${dataGovId}`);

  const files: DiscoveredFile[] = [];
  for (const resource of data.result.resources) {
    const format = resource.format?.toLowerCase().trim() || "";
    if (!["csv", "xlsx", "xls"].includes(format)) continue;

    const filename =
      resource.url.split("/").pop()?.split("?")[0] ||
      resource.name.replace(/\s+/g, "-") + "." + format;

    files.push({
      url: resource.url,
      filename: decodeURIComponent(filename),
      format,
      modified: resource.last_modified || resource.created || undefined,
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Strategy B: HTML page scraping
// ---------------------------------------------------------------------------

export async function discoverViaHtml(
  transparencyUrl: string,
  filePatternStr?: string | null
): Promise<DiscoveredFile[]> {
  const res = await fetch(transparencyUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${transparencyUrl}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const baseUrl = new URL(transparencyUrl);
  const fileRegex = filePatternStr
    ? new RegExp(filePatternStr, "i")
    : /\.(csv|xlsx|xls)(\?|$)/i;

  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (!fileRegex.test(href)) return;

    let fullUrl: string;
    try {
      fullUrl = new URL(href, baseUrl.origin).href;
    } catch {
      return;
    }

    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const rawFilename = fullUrl.split("/").pop()?.split("?")[0] || "";
    const filename = decodeURIComponent(rawFilename).replace(/\s+/g, "-");
    const ext = filename.split(".").pop()?.toLowerCase() || "csv";

    files.push({
      url: fullUrl,
      filename,
      format: ext,
    });
  });

  return files;
}

// ---------------------------------------------------------------------------
// Combined discovery
// ---------------------------------------------------------------------------

export async function discoverFiles(
  config: CouncilConfig
): Promise<DiscoveredFile[]> {
  // Try CKAN first if available
  if (config.dataGovId) {
    try {
      const files = await discoverViaCkan(config.dataGovId);
      if (files.length > 0) return files;
      console.log(`  CKAN returned 0 files for ${config.slug}, falling back to HTML`);
    } catch (err) {
      console.warn(`  CKAN failed for ${config.slug}: ${err}, falling back to HTML`);
    }
  }

  // Fall back to HTML scraping
  if (config.transparencyUrl) {
    return discoverViaHtml(config.transparencyUrl, config.filePattern);
  }

  console.warn(`  No discovery source for ${config.slug} (no CKAN ID or transparency URL)`);
  return [];
}

// ---------------------------------------------------------------------------
// File download helper
// ---------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";

export async function downloadFile(
  url: string,
  destDir: string,
  filename: string
): Promise<string> {
  const dest = path.join(destDir, filename);
  if (fs.existsSync(dest)) return dest;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, buffer);
  return dest;
}
