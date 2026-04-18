import { runJsx, jsxLit } from "../bridge.js";

export async function openFile(path) {
    const body = `
        var f = new File(${jsxLit(path)});
        if (!f.exists) throw new Error("File not found: " + ${jsxLit(path)});
        var doc = app.open(f);
        return { name: doc.name, path: doc.fullName.fsName };
    `;
    return runJsx(body);
}

export async function saveFile(path, format = "ai") {
    const body = `
        if (app.documents.length === 0) throw new Error("No open document");
        var doc = app.activeDocument;
        var f = new File(${jsxLit(path)});
        var fmt = ${jsxLit(String(format).toLowerCase())};

        if (fmt === "ai") {
            var opts = new IllustratorSaveOptions();
            doc.saveAs(f, opts);
        } else if (fmt === "svg") {
            var opts = new ExportOptionsSVG();
            doc.exportFile(f, ExportType.SVG, opts);
        } else if (fmt === "pdf") {
            var opts = new PDFSaveOptions();
            doc.saveAs(f, opts);
        } else if (fmt === "png") {
            var opts = new ExportOptionsPNG24();
            opts.transparency = true;
            opts.artBoardClipping = true;
            doc.exportFile(f, ExportType.PNG24, opts);
        } else if (fmt === "jpg" || fmt === "jpeg") {
            var opts = new ExportOptionsJPEG();
            opts.qualitySetting = 85;
            opts.artBoardClipping = true;
            doc.exportFile(f, ExportType.JPEG, opts);
        } else {
            throw new Error("Unsupported format: " + fmt);
        }
        return { saved: f.fsName, format: fmt };
    `;
    return runJsx(body);
}

export async function closeFile() {
    const body = `
        if (app.documents.length === 0) throw new Error("No open document");
        var name = app.activeDocument.name;
        app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
        return { closed: name };
    `;
    return runJsx(body);
}
