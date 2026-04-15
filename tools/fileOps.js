import { z } from "zod";
import { runJsx } from "../bridge/comBridge.js";

export const openFile = {
  name: "open_file",
  description: "Open an existing file in Illustrator (.ai, .svg, .pdf, .eps).",
  schema: {
    path: z.string().describe("Absolute path to the file to open."),
  },
  handler: async ({ path }) => {
    const p = path.replace(/\\/g, "/");
    return runJsx(`
      var f = new File("${p}");
      if (!f.exists) throw new Error("File not found: ${p}");
      var doc = app.open(f);
      __ok({ name: doc.name, path: doc.fullName.fsName });
    `);
  },
};

export const saveFile = {
  name: "save_file",
  description:
    "Save the active document. Format controls the export type: ai, svg, pdf, png, jpg.",
  schema: {
    path: z.string().describe("Absolute output path. Extension should match format."),
    format: z.enum(["ai", "svg", "pdf", "png", "jpg"]),
  },
  handler: async ({ path, format }) => {
    const p = path.replace(/\\/g, "/");
    return runJsx(`
      var doc = __requireDoc();
      var out = new File("${p}");
      switch ("${format}") {
        case "ai": {
          var opts = new IllustratorSaveOptions();
          doc.saveAs(out, opts);
          break;
        }
        case "svg": {
          var sopts = new ExportOptionsSVG();
          doc.exportFile(out, ExportType.SVG, sopts);
          break;
        }
        case "pdf": {
          var popts = new PDFSaveOptions();
          doc.saveAs(out, popts);
          break;
        }
        case "png": {
          var popts2 = new ExportOptionsPNG24();
          popts2.transparency = true;
          doc.exportFile(out, ExportType.PNG24, popts2);
          break;
        }
        case "jpg": {
          var jopts = new ExportOptionsJPEG();
          jopts.qualitySetting = 80;
          doc.exportFile(out, ExportType.JPEG, jopts);
          break;
        }
        default: throw new Error("Unsupported format: ${format}");
      }
      __ok({ path: out.fsName });
    `);
  },
};

export const closeFile = {
  name: "close_file",
  description: "Close the currently active document (without saving).",
  schema: {},
  handler: async () =>
    runJsx(`
      var doc = __requireDoc();
      var name = doc.name;
      doc.close(SaveOptions.DONOTSAVECHANGES);
      __ok({ closed: name });
    `),
};

export const fileTools = [openFile, saveFile, closeFile];
