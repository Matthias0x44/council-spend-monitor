/**
 * Generic file discovery for council spending data.
 *
 * Three strategies (tried in order):
 *   A) data.gov.uk CKAN API — returns direct download URLs with metadata
 *   B) HTML page scraping — follows links on a transparency page
 *   C) Sub-page crawling — follows index links one level deep to find files
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

const SPEND_KEYWORDS =
  /spend|expenditure|payment|supplier|invoice|over.500|over.250|transparency/i;

const MONTH_PATTERN =
  /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december/i;

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

const NON_DATA_EXTENSIONS = /\.(pdf|html|htm|aspx|php|doc|docx|pptx|png|jpg|jpeg|gif|svg|zip)(\?|#|$)/i;

function hasFileExtension(href: string): string | null {
  const match = href.match(/\.(csv|xlsx|xls)(\?|#|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function looksLikeSpendFile(href: string, linkText: string): boolean {
  if (NON_DATA_EXTENSIONS.test(href)) return false;
  if (/gov\.uk\/government\/publications/i.test(href)) return false;
  const combined = `${href} ${linkText}`.toLowerCase();
  return SPEND_KEYWORDS.test(combined) && MONTH_PATTERN.test(combined);
}

function looksLikeSubPage(href: string, linkText: string): boolean {
  const combined = `${href} ${linkText}`.toLowerCase();
  if (hasFileExtension(href)) return false;
  return (
    SPEND_KEYWORDS.test(combined) &&
    (combined.includes("download") ||
      combined.includes("current") ||
      combined.includes("archive") ||
      combined.includes("20") || // year like 2024, 2025
      /\d{4}/.test(combined))
  );
}

function resolveUrl(href: string, baseOrigin: string): string | null {
  try {
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    return new URL(href, baseOrigin).href;
  } catch {
    return null;
  }
}

function extractFilesFromHtml(
  html: string,
  baseOrigin: string,
  filePatternStr?: string | null
): { files: DiscoveredFile[]; subPageUrls: string[] } {
  const $ = cheerio.load(html);
  const customRegex = filePatternStr ? new RegExp(filePatternStr, "i") : null;

  const files: DiscoveredFile[] = [];
  const subPageUrls: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href || href === "#" || href.startsWith("mailto:") || href.startsWith("javascript:")) return;

    const linkText = $(el).text().trim();
    const fullUrl = resolveUrl(href, baseOrigin);
    if (!fullUrl || seen.has(fullUrl)) return;
    seen.add(fullUrl);

    // Check for direct file extension match
    const ext = hasFileExtension(href);
    if (ext) {
      const rawFilename = fullUrl.split("/").pop()?.split("?")[0] || "";
      const filename = decodeURIComponent(rawFilename).replace(/\s+/g, "-");
      files.push({ url: fullUrl, filename, format: ext });
      return;
    }

    // Check custom file pattern (matches on href or link text)
    if (customRegex && customRegex.test(`${href} ${linkText}`)) {
      const slug = fullUrl.split("/").pop()?.split("?")[0] || "unknown";
      const filename = decodeURIComponent(slug).replace(/\s+/g, "-");
      files.push({ url: fullUrl, filename: filename + ".csv", format: "csv" });
      return;
    }

    // Check if link text + href look like a spending file without extension
    if (looksLikeSpendFile(href, linkText)) {
      const slug = fullUrl.split("/").pop()?.split("?")[0] || "unknown";
      const filename = decodeURIComponent(slug).replace(/\s+/g, "-");
      files.push({ url: fullUrl, filename: filename + ".csv", format: "csv" });
      return;
    }

    // Check if this looks like an index sub-page worth crawling
    if (looksLikeSubPage(href, linkText)) {
      subPageUrls.push(fullUrl);
    }
  });

  return { files, subPageUrls };
}

export async function discoverViaHtml(
  transparencyUrl: string,
  filePatternStr?: string | null
): Promise<DiscoveredFile[]> {
  const res = await fetch(transparencyUrl, {
    headers: { "User-Agent": "CouncilSpendMonitor/1.0 (transparency research)" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${transparencyUrl}`);
  }
  const html = await res.text();
  const baseOrigin = new URL(transparencyUrl).origin;

  const { files, subPageUrls } = extractFilesFromHtml(html, baseOrigin, filePatternStr);

  if (files.length > 0) return files;

  // No direct files found — try following sub-pages one level deep
  if (subPageUrls.length > 0) {
    console.log(`  No direct files on main page, crawling ${subPageUrls.length} sub-page(s)...`);

    const MAX_SUBPAGES = 10;
    const toVisit = subPageUrls.slice(0, MAX_SUBPAGES);
    const allFiles: DiscoveredFile[] = [];
    const seenUrls = new Set<string>();

    for (const subUrl of toVisit) {
      try {
        const subRes = await fetch(subUrl, {
          headers: { "User-Agent": "CouncilSpendMonitor/1.0 (transparency research)" },
        });
        if (!subRes.ok) continue;
        const subHtml = await subRes.text();
        const subBase = new URL(subUrl).origin;
        const { files: subFiles } = extractFilesFromHtml(subHtml, subBase, filePatternStr);

        for (const f of subFiles) {
          if (!seenUrls.has(f.url)) {
            seenUrls.add(f.url);
            allFiles.push(f);
          }
        }
      } catch (err) {
        console.warn(`  Sub-page fetch failed: ${subUrl}: ${err}`);
      }
    }

    if (allFiles.length > 0) {
      console.log(`  Found ${allFiles.length} files from sub-pages`);
      return allFiles;
    }
  }

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

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "text/csv": ".csv",
  "application/csv": ".csv",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/octet-stream": "",
};

export async function downloadFile(
  url: string,
  destDir: string,
  filename: string
): Promise<string> {
  const dest = path.join(destDir, filename);
  if (fs.existsSync(dest)) return dest;

  const res = await fetch(url, {
    headers: { "User-Agent": "CouncilSpendMonitor/1.0 (transparency research)" },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);

  // If filename has no real extension, try to infer from content-type
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  let finalFilename = filename;
  const hasExt = /\.(csv|xlsx|xls)$/i.test(filename);
  if (!hasExt && contentType) {
    const ext = EXTENSION_BY_CONTENT_TYPE[contentType];
    if (ext) {
      finalFilename = filename.replace(/\.csv$/, "") + ext;
    } else if (contentType.includes("csv") || contentType.includes("text/plain")) {
      finalFilename = filename.replace(/\.csv$/, "") + ".csv";
    } else if (contentType.includes("excel") || contentType.includes("spreadsheet")) {
      finalFilename = filename.replace(/\.csv$/, "") + ".xlsx";
    }
  }

  const finalDest = path.join(destDir, finalFilename);
  if (fs.existsSync(finalDest)) return finalDest;

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(finalDest, buffer);
  return finalDest;
}
