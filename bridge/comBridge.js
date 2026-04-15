// Windows COM bridge: runs ExtendScript (.jsx) inside the running Illustrator
// instance via PowerShell + the Illustrator.Application COM object.
//
// Strategy:
//   1. Write the JSX to a temp file, prefixed with a helper that defines
//      __writeResult(obj) — serializes {success, data, error} to a temp JSON file.
//   2. Spawn PowerShell; it creates the COM object and calls DoJavaScriptFile.
//   3. Node reads the JSON file and returns it.
//
// Why a file instead of the return value of DoJavaScript?
//   COM marshalling of complex ExtendScript return values is unreliable. A JSON
//   file round-trip is boring and works.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_DIR = join(tmpdir(), "illustrator-mcp");

async function ensureTmp() {
  if (!existsSync(TMP_DIR)) {
    await mkdir(TMP_DIR, { recursive: true });
  }
}

/**
 * JSX prelude: provides a JSON polyfill (ExtendScript lacks native JSON),
 * a __writeResult helper that writes to a path passed in via a global, and
 * a __findByName helper used by most tools.
 */
function buildPrelude(resultPath) {
  // ExtendScript path literal must use forward slashes or escaped backslashes.
  const escaped = resultPath.replace(/\\/g, "/");
  return `
// ---- MCP prelude ----
var __resultPath = "${escaped}";

// Minimal JSON for ExtendScript (Douglas Crockford, trimmed).
if (typeof JSON !== "object") { JSON = {}; }
(function () {
  function f(n) { return n < 10 ? "0" + n : n; }
  var cx = /[\\u0000\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]/g,
      escapable = /[\\\\\\"\\x00-\\x1f\\x7f-\\x9f\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]/g,
      gap, indent,
      meta = { "\\b": "\\\\b", "\\t": "\\\\t", "\\n": "\\\\n", "\\f": "\\\\f", "\\r": "\\\\r", '"': '\\\\"', "\\\\": "\\\\\\\\" },
      rep;
  function quote(string) {
    escapable.lastIndex = 0;
    return escapable.test(string)
      ? '"' + string.replace(escapable, function (a) {
          var c = meta[a];
          return typeof c === "string" ? c : "\\\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"'
      : '"' + string + '"';
  }
  function str(key, holder) {
    var i, k, v, length, mind = gap, partial, value = holder[key];
    if (value && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON(key);
    if (typeof rep === "function") value = rep.call(holder, key, value);
    switch (typeof value) {
      case "string": return quote(value);
      case "number": return isFinite(value) ? String(value) : "null";
      case "boolean": case "null": return String(value);
      case "object":
        if (!value) return "null";
        gap += indent;
        partial = [];
        if (Object.prototype.toString.apply(value) === "[object Array]") {
          length = value.length;
          for (i = 0; i < length; i += 1) partial[i] = str(i, value) || "null";
          v = partial.length === 0 ? "[]" : gap ? "[\\n" + gap + partial.join(",\\n" + gap) + "\\n" + mind + "]" : "[" + partial.join(",") + "]";
          gap = mind;
          return v;
        }
        for (k in value) {
          if (Object.prototype.hasOwnProperty.call(value, k)) {
            v = str(k, value);
            if (v) partial.push(quote(k) + (gap ? ": " : ":") + v);
          }
        }
        v = partial.length === 0 ? "{}" : gap ? "{\\n" + gap + partial.join(",\\n" + gap) + "\\n" + mind + "}" : "{" + partial.join(",") + "}";
        gap = mind;
        return v;
    }
  }
  if (typeof JSON.stringify !== "function") {
    JSON.stringify = function (value, replacer, space) {
      var i; gap = ""; indent = "";
      if (typeof space === "number") for (i = 0; i < space; i += 1) indent += " ";
      else if (typeof space === "string") indent = space;
      rep = replacer;
      return str("", { "": value });
    };
  }
}());

function __writeResult(obj) {
  var f = new File(__resultPath);
  f.encoding = "UTF-8";
  f.open("w");
  f.write(JSON.stringify(obj));
  f.close();
}

function __ok(data)  { __writeResult({ success: true,  data: data == null ? null : data }); }
function __fail(msg) { __writeResult({ success: false, error: String(msg) }); }

function __requireDoc() {
  if (app.documents.length === 0) throw new Error("No document open in Illustrator");
  return app.activeDocument;
}

// Find the first page item whose name matches. Returns null if not found.
function __findByName(name) {
  var doc = __requireDoc();
  function walk(items) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.name === name) return it;
      if (it.typename === "GroupItem" && it.pageItems) {
        var found = walk(it.pageItems);
        if (found) return found;
      }
    }
    return null;
  }
  // Search layers (including sublayers) and page items.
  for (var l = 0; l < doc.layers.length; l++) {
    var layer = doc.layers[l];
    var f = walk(layer.pageItems);
    if (f) return f;
  }
  return null;
}

// Parse a color spec: {r,g,b} 0-255, or {c,m,y,k} 0-100, or "#rrggbb".
// Returns an Illustrator color object appropriate for the document's color space.
function __toColor(spec) {
  var doc = __requireDoc();
  var isCMYK = (doc.documentColorSpace === DocumentColorSpace.CMYK);
  if (typeof spec === "string" && spec.charAt(0) === "#") {
    var hex = spec.substring(1);
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    spec = { r: r, g: g, b: b };
  }
  if (spec.c != null || spec.m != null || spec.y != null || spec.k != null) {
    var cc = new CMYKColor();
    cc.cyan = spec.c || 0; cc.magenta = spec.m || 0; cc.yellow = spec.y || 0; cc.black = spec.k || 0;
    return cc;
  }
  if (isCMYK) {
    // Convert RGB -> CMYK (naive) so we don't get conversion warnings.
    var r2 = (spec.r || 0) / 255, g2 = (spec.g || 0) / 255, b2 = (spec.b || 0) / 255;
    var k = 1 - Math.max(r2, g2, b2);
    var cc2 = new CMYKColor();
    if (k >= 1) { cc2.cyan = 0; cc2.magenta = 0; cc2.yellow = 0; cc2.black = 100; return cc2; }
    cc2.cyan    = ((1 - r2 - k) / (1 - k)) * 100;
    cc2.magenta = ((1 - g2 - k) / (1 - k)) * 100;
    cc2.yellow  = ((1 - b2 - k) / (1 - k)) * 100;
    cc2.black   = k * 100;
    return cc2;
  }
  var rc = new RGBColor();
  rc.red = spec.r || 0; rc.green = spec.g || 0; rc.blue = spec.b || 0;
  return rc;
}
// ---- end prelude ----
`;
}

/**
 * Run an ExtendScript snippet inside Illustrator via COM.
 * The snippet should call __ok(data) or __fail(msg) exactly once.
 *
 * @param {string} scriptBody - JSX source (prelude is prepended).
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export async function runJsx(scriptBody) {
  await ensureTmp();
  const id = randomUUID();
  const scriptPath = join(TMP_DIR, `${id}.jsx`);
  const resultPath = join(TMP_DIR, `${id}.json`);

  const full = `${buildPrelude(resultPath)}
try {
${scriptBody}
} catch (e) {
  __fail(e && e.message ? e.message : String(e));
}
`;
  await writeFile(scriptPath, full, "utf8");

  const ps = [
    "$ErrorActionPreference='Stop';",
    "try {",
    "  $ai = New-Object -ComObject Illustrator.Application;",
    `  $ai.DoJavaScriptFile('${scriptPath.replace(/'/g, "''")}', $null, 2);`,
    "} catch {",
    `  $err = @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress;`,
    `  Set-Content -Path '${resultPath.replace(/'/g, "''")}' -Value $err -Encoding UTF8;`,
    "  exit 1;",
    "}",
  ].join(" ");

  await new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true }
    );
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", () => resolve(stderr));
    child.on("error", () => resolve(stderr));
  });

  let raw;
  try {
    raw = await readFile(resultPath, "utf8");
  } catch {
    await safeUnlink(scriptPath);
    return {
      success: false,
      error:
        "Could not read result file. Is Illustrator running and a document open? " +
        "If Illustrator is not installed or not registered for COM, this call will fail.",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { success: false, error: `Invalid JSON from ExtendScript: ${raw.slice(0, 500)}` };
  }

  await Promise.all([safeUnlink(scriptPath), safeUnlink(resultPath)]);
  return parsed;
}

async function safeUnlink(p) {
  try {
    await rm(p, { force: true });
  } catch {
    /* ignore */
  }
}
