import { publicFetch } from "./public-fetch";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
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

function decodeFilename(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

import { isPaymentPublication } from "./publication-type.mjs";
export { isPaymentPublication } from "./publication-type.mjs";

const SPEND_KEYWORDS =
  /spend|expenditure|payment|supplier|invoice|over.500|over.250|transparency/i;

const MONTH_PATTERN =
  /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december/i;

// ---------------------------------------------------------------------------
// Strategy A: data.gov.uk CKAN API
// ---------------------------------------------------------------------------

interface CkanResource {
  url: string;
  name?: string;
  format?: string;
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
  dataGovId: string,
  ckanBaseUrl = "https://data.gov.uk"
): Promise<DiscoveredFile[]> {
  const base = ckanBaseUrl.replace(/\/$/, "");
  const apiUrl = `${base}/api/3/action/package_show?id=${encodeURIComponent(dataGovId)}`;
  const res = await publicFetch(apiUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`CKAN API error ${res.status} for ${dataGovId} @ ${base}`);
  }

  const data = (await res.json()) as CkanPackageShow;
  if (!data.success) throw new Error(`CKAN returned success=false for ${dataGovId}`);

  const files: DiscoveredFile[] = [];
  for (const resource of data.result.resources) {
    let format = resource.format?.toLowerCase().trim() || "";
    const nameOrUrl = `${resource.name || ""} ${resource.url || ""}`;
    if (!format) {
      const m = nameOrUrl.match(/\.(csv|xlsx|xlsm|xls)(\?|#|$)/i);
      if (m) format = m[1].toLowerCase();
    }
    if (!["csv", "xlsx", "xlsm", "xls"].includes(format)) continue;

    const filename =
      resource.url.split("/").pop()?.split("?")[0] ||
      (resource.name || "download").replace(/\s+/g, "-") + "." + format;

    files.push({
      url: resource.url,
      filename: decodeFilename(filename),
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
  const match = href.match(/\.(csv|xlsx|xlsm|xls)(\?|#|$)/i);
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

    const linkText = [$(el).text(), $(el).attr("aria-label"), $(el).attr("title")].filter(Boolean).join(" ").trim();
    const fullUrl = resolveUrl(href, baseOrigin);
    if (!fullUrl || seen.has(fullUrl)) return;
    seen.add(fullUrl);
    if (!isPaymentPublication(`${href} ${linkText}`)) return;

    // Check for direct file extension match
    const ext = hasFileExtension(href);
    if (ext && (customRegex ? customRegex.test(`${href} ${linkText}`) : (SPEND_KEYWORDS.test(`${href} ${linkText}`) || (/spend|expenditure|payment|over.500|over.250/i.test(baseOrigin) && MONTH_PATTERN.test(linkText)))) && !/budget|outturn|statement.of.accounts|pay.multiple|senior.salar|contracts?.register|procurement.pipeline/i.test(`${href} ${linkText}`)) {
      const rawFilename = fullUrl.split("/").pop()?.split("?")[0] || "";
      const filename = decodeFilename(rawFilename).replace(/\s+/g, "-");
      files.push({ url: fullUrl, filename, format: ext });
      return;
    }

    // Check custom file pattern (matches on href or link text)
    if (customRegex && customRegex.test(`${href} ${linkText}`)) {
      const slug = fullUrl.split("/").pop()?.split("?")[0] || "unknown";
      const filename = decodeFilename(slug).replace(/\s+/g, "-");
      files.push({ url: fullUrl, filename: filename + ".csv", format: "csv" });
      return;
    }

    // Check if link text + href look like a spending file without extension
    if (looksLikeSpendFile(href, linkText)) {
      const slug = fullUrl.split("/").pop()?.split("?")[0] || "unknown";
      const filename = decodeFilename(slug).replace(/\s+/g, "-");
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
  // Direct export / file URLs (OpenDataSoft exports, raw CSV links)
  const directExt = transparencyUrl.match(/\.(csv|xlsx|xlsm|xls)(\?|#|$)/i);
  const odsExport = /\/exports\/(csv|xlsx|xlsm|xls)(\?|#|$)/i.exec(transparencyUrl);
  if (directExt || odsExport) {
    const format = (directExt?.[1] || odsExport?.[1] || "csv").toLowerCase();
    const filename =
      transparencyUrl.split("/").pop()?.split("?")[0]?.replace(/[^a-z0-9._-]+/gi, "-") ||
      `export.${format}`;
    const safeName = filename.includes(".") ? filename : `${filename}.${format}`;
    return [
      {
        url: transparencyUrl,
        filename: safeName.endsWith(`.${format}`) ? safeName : `${safeName}.${format}`,
        format,
      },
    ];
  }

  const res = await publicFetch(transparencyUrl, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; CouncilSpendMonitor/1.0; +https://github.com/local-spend)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${transparencyUrl}`);
  }
  const html = await res.text();
  const baseOrigin = transparencyUrl;

  const { files, subPageUrls } = extractFilesFromHtml(html, baseOrigin, filePatternStr);



  // Include archive pages even when the main page already has recent files.
  if (subPageUrls.length > 0) {
    console.log(`  Crawling ${subPageUrls.length} sub-page(s)...`);

    const MAX_SUBPAGES = 100;
    const toVisit = subPageUrls.filter(u => new URL(u).origin === new URL(transparencyUrl).origin).slice(0, MAX_SUBPAGES);
    const allFiles: DiscoveredFile[] = [...files];
    const seenUrls = new Set<string>(files.map(f => f.url));

    for (const subUrl of toVisit) {
      try {
        const subRes = await publicFetch(subUrl, {
          signal: AbortSignal.timeout(20000),
          headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CouncilSpendMonitor/1.0; +https://github.com/local-spend)",
          Accept: "text/html,application/xhtml+xml",
        },
        });
        if (!subRes.ok) continue;
        const subHtml = await subRes.text();
        const subBase = subUrl;
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

/**
 * Many councils publish the same monthly file in multiple formats
 * (Stockport's "All Spend" is in both CSV and XLSX; data.gov.uk
 * resources sometimes duplicate). De-duplicate by a normalised
 * basename so we only ingest the data once. Format preference:
 * CSV > XLSX > XLS.
 */
const FORMAT_RANK: Record<string, number> = { csv: 0, xlsx: 1, xls: 2 };

function dedupeFiles(files: DiscoveredFile[]): DiscoveredFile[] {
  const byKey = new Map<string, DiscoveredFile>();
  for (const f of files) {
    const stem = new URL(f.url).pathname.replace(/\.[^/.]+$/, "") + "|" + f.filename
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[\s_+\-.]+/g, "");
    if (!stem) {
      byKey.set(f.url, f);
      continue;
    }
    const existing = byKey.get(stem);
    if (!existing) {
      byKey.set(stem, f);
      continue;
    }
    const rankNew = FORMAT_RANK[f.format] ?? 99;
    const rankOld = FORMAT_RANK[existing.format] ?? 99;
    if (rankNew < rankOld) byKey.set(stem, f);
  }
  return [...byKey.values()];
}

export async function discoverFiles(
  config: CouncilConfig
): Promise<DiscoveredFile[]> {
  let files: DiscoveredFile[] = [];

  // Try CKAN first if available. dataGovId may be:
  //   - a data.gov.uk package UUID / name
  //   - "datamill:<id>" for DataMill North
  //   - "ckan:<host>/<id>" for other CKAN portals
  if (config.dataGovId) {
    try {
      let ckanBase = "https://data.gov.uk";
      let packageId = config.dataGovId;
      if (packageId.startsWith("datamill:")) {
        ckanBase = "https://datamillnorth.org";
        packageId = packageId.slice("datamill:".length);
      } else if (packageId.startsWith("ckan:")) {
        const rest = packageId.slice("ckan:".length);
        const slash = rest.indexOf("/");
        if (slash > 0) {
          ckanBase = `https://${rest.slice(0, slash)}`;
          packageId = rest.slice(slash + 1);
        }
      }
      files = await discoverViaCkan(packageId, ckanBase);
      if (files.length === 0) {
        console.log(`  CKAN returned 0 files for ${config.slug}, falling back to HTML`);
      }
    } catch (err) {
      console.warn(`  CKAN failed for ${config.slug}: ${err}, falling back to HTML`);
    }
  }

  // Fall back to HTML scraping
  if (config.transparencyUrl) {
    try { files.push(...await discoverViaHtml(config.transparencyUrl, config.filePattern)); }
    catch (error) { if (!files.length) throw error; console.warn(`HTML discovery failed for ${config.slug}: ${error}`); }
  }

  if (files.length === 0) {
    console.warn(`  No discovery source for ${config.slug} (no CKAN ID or transparency URL)`);
    return [];
  }

  const deduped = dedupeFiles(files);
  if (deduped.length !== files.length) {
    console.log(
      `  Deduped ${files.length} → ${deduped.length} files for ${config.slug}`
    );
  }
  return deduped;
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
  filename: string,
  refresh = false
): Promise<string> {
  const suffix = createHash("sha256").update(url).digest("hex").slice(0, 12);
  filename = `${suffix}-${path.basename(filename).replace(/[^a-zA-Z0-9._ -]/g, "_")}`;
  const dest = path.join(destDir, filename);
  if (!refresh && !fs.existsSync(dest) && fs.existsSync(dest + ".gz")) fs.writeFileSync(dest, gunzipSync(fs.readFileSync(dest + ".gz"), { maxOutputLength: 64 * 1024 * 1024 }));
  if (!refresh && fs.existsSync(dest)) {
    // Re-download if a previous run cached an HTML error page under this name.
    const existing = fs.readFileSync(dest);
    const head = existing.slice(0, 120).toString("utf8").toLowerCase();
    if (!head.includes("<!doctype html") && !head.includes("<html")) {
      return dest;
    }
    fs.unlinkSync(dest);
  }

  const res = await publicFetch(url, {
    signal: AbortSignal.timeout(60000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/csv,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
    },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);

  // If filename has no real extension, try to infer from content-type
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  let finalFilename = filename;
  const hasExt = /\.(csv|xlsx|xlsm|xls)$/i.test(filename);
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
  if (!refresh && fs.existsSync(finalDest)) {
    const existing = fs.readFileSync(finalDest);
    const head = existing.slice(0, 120).toString("utf8").toLowerCase();
    if (!head.includes("<!doctype html") && !head.includes("<html")) {
      return finalDest;
    }
    fs.unlinkSync(finalDest);
  }

  const MAX_BYTES = 64 * 1024 * 1024;
  if (Number(res.headers.get("content-length")) > MAX_BYTES) { await res.body?.cancel(); throw new Error(`File exceeds 64 MiB: ${url}`); }
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`Empty response: ${url}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error(`File exceeds 64 MiB: ${url}`); }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  const head = buffer.slice(0, 120).toString("utf8").toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) {
    throw new Error(`Download returned HTML instead of spreadsheet: ${url}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(finalDest + ".tmp", buffer);
  fs.renameSync(finalDest + ".tmp", finalDest);
  return finalDest;
}
