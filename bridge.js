// bridge.js — Runs ExtendScript (.jsx) inside a running Adobe Illustrator instance on Windows.
// Strategy:
//   1. Write the JSX snippet to a temp file.
//   2. Spawn a short VBScript that uses COM (Illustrator.Application) + DoJavaScriptFile
//      to execute the JSX inside Illustrator and write the return value to a result file.
//   3. Read and parse the result file as JSON.
//
// The JSX is expected to end with an expression that serializes to JSON (or a plain string).
// We wrap user scripts in a try/catch that always returns JSON like:
//   {"ok":true,"data":...}  or  {"ok":false,"error":"..."}
//
// macOS support could be added by switching to `osascript` + `do javascript`.

import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal JSON.stringify polyfill for ExtendScript (has no built-in JSON).
const JSON_POLYFILL = `
if (typeof JSON === "undefined" || !JSON.stringify) {
    JSON = {};
    JSON.stringify = function (val) {
        function esc(s) {
            return s.replace(/\\\\/g, "\\\\\\\\")
                    .replace(/"/g, '\\\\"')
                    .replace(/\\n/g, "\\\\n")
                    .replace(/\\r/g, "\\\\r")
                    .replace(/\\t/g, "\\\\t");
        }
        function ser(v) {
            if (v === null || v === undefined) return "null";
            var t = typeof v;
            if (t === "number") return isFinite(v) ? String(v) : "null";
            if (t === "boolean") return v ? "true" : "false";
            if (t === "string") return '"' + esc(v) + '"';
            if (v instanceof Array) {
                var a = [];
                for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
                return "[" + a.join(",") + "]";
            }
            if (t === "object") {
                var p = [];
                for (var k in v) {
                    if (v.hasOwnProperty(k)) {
                        var sv = ser(v[k]);
                        if (sv !== undefined) p.push('"' + esc(k) + '":' + sv);
                    }
                }
                return "{" + p.join(",") + "}";
            }
            return "null";
        }
        return ser(val);
    };
}
`;

const JSX_WRAPPER = (body) => `
${JSON_POLYFILL}
(function () {
    try {
        var __result = (function () { ${body} })();
        if (typeof __result === "undefined") __result = null;
        return "__MCP_OK__" + JSON.stringify(__result);
    } catch (e) {
        return "__MCP_ERR__" + (e && e.message ? e.message : String(e));
    }
})();
`;

function vbsTemplate(jsxPath, resultPath) {
    // VBScript: talks to Illustrator via COM, runs DoJavaScriptFile, writes result to disk.
    // DoJavaScriptFile returns the value of the last expression as a string.
    return `
On Error Resume Next
Dim app, fso, ts, result
Set app = CreateObject("Illustrator.Application")
If Err.Number <> 0 Then
    WriteResult "__MCP_ERR__ILLUSTRATOR_NOT_AVAILABLE: " & Err.Description
    WScript.Quit 2
End If
Err.Clear

result = app.DoJavaScriptFile("${jsxPath.replace(/\\/g, "\\\\")}")
If Err.Number <> 0 Then
    WriteResult "__MCP_ERR__JSX_EXEC: " & Err.Description
    WScript.Quit 3
End If

WriteResult result
WScript.Quit 0

Sub WriteResult(s)
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set ts = fso.CreateTextFile("${resultPath.replace(/\\/g, "\\\\")}", True, True)
    ts.Write s
    ts.Close
End Sub
`;
}

/**
 * Execute a JSX snippet inside the running Illustrator instance.
 * @param {string} body  - JSX body. Should `return` a JSON-serializable value.
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
 */
export async function runJsx(body) {
    const dir = await mkdtemp(join(tmpdir(), "ill-mcp-"));
    const jsxPath = join(dir, "script.jsx");
    const vbsPath = join(dir, "run.vbs");
    const resultPath = join(dir, "result.txt");

    try {
        await writeFile(jsxPath, JSX_WRAPPER(body), "utf8");
        await writeFile(vbsPath, vbsTemplate(jsxPath, resultPath), "utf8");

        const exitCode = await new Promise((resolve) => {
            const proc = spawn("cscript.exe", ["//Nologo", "//B", vbsPath], {
                windowsHide: true,
            });
            proc.on("exit", (code) => resolve(code ?? -1));
            proc.on("error", () => resolve(-1));
        });

        let raw = "";
        try {
            raw = await readFile(resultPath, "utf16le");
        } catch {
            return {
                ok: false,
                error: `Illustrator bridge failed (exit=${exitCode}). Is Illustrator running?`,
            };
        }

        // Strip BOM if any.
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
        raw = raw.trim();

        if (raw.startsWith("__MCP_OK__")) {
            const payload = raw.slice("__MCP_OK__".length);
            try {
                return { ok: true, data: JSON.parse(payload) };
            } catch {
                return { ok: true, data: payload };
            }
        }
        if (raw.startsWith("__MCP_ERR__")) {
            return { ok: false, error: raw.slice("__MCP_ERR__".length) };
        }
        return { ok: false, error: `Unexpected bridge output: ${raw.slice(0, 200)}` };
    } finally {
        rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

/** Utility: JSON-encode a JS value into a JSX literal (safe for embedding). */
export function jsxLit(value) {
    return JSON.stringify(value);
}

/**
 * Coerce a value to a finite number for safe template interpolation.
 * Anything non-finite (NaN/Infinity/null/undefined/string junk) falls back.
 * Guarantees the returned value stringifies to a plain numeric literal.
 */
export function safeNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
