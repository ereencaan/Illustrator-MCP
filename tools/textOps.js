import { runJsx, jsxLit, safeNum } from "../bridge.js";

const HELPERS = `
    function requireDoc() {
        if (app.documents.length === 0) throw new Error("No open document");
        return app.activeDocument;
    }
    function findText(doc, name) {
        for (var i = 0; i < doc.textFrames.length; i++) {
            if (doc.textFrames[i].name === name) return doc.textFrames[i];
        }
        return null;
    }
    function toRgb(c) {
        var r, g, b;
        if (typeof c === "string") {
            var s = c.charAt(0) === "#" ? c.substring(1) : c;
            // Expand 3-digit hex (#abc -> #aabbcc).
            if (s.length === 3) s = s.charAt(0)+s.charAt(0)+s.charAt(1)+s.charAt(1)+s.charAt(2)+s.charAt(2);
            if (s.length !== 6) throw new Error("Invalid hex color: " + c);
            r = parseInt(s.substring(0,2),16);
            g = parseInt(s.substring(2,4),16);
            b = parseInt(s.substring(4,6),16);
            if (isNaN(r) || isNaN(g) || isNaN(b)) throw new Error("Invalid hex color: " + c);
        } else if (c && c.length >= 3 && typeof c[0] === "number" && typeof c[1] === "number" && typeof c[2] === "number") {
            r = c[0]; g = c[1]; b = c[2];
        } else {
            throw new Error("Invalid color value");
        }
        var col = new RGBColor();
        col.red = r; col.green = g; col.blue = b;
        return col;
    }
`;

export async function getTextObjects() {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var out = [];
        for (var i = 0; i < doc.textFrames.length; i++) {
            var t = doc.textFrames[i];
            out.push({
                name: t.name || "(unnamed)",
                contents: t.contents,
                length: t.contents.length
            });
        }
        return out;
    `;
    return runJsx(body);
}

export async function setFont(objectName, fontFamily, fontSize, fontWeight = "Regular") {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var t = findText(doc, ${jsxLit(objectName)});
        if (!t) throw new Error("Text not found: " + ${jsxLit(objectName)});
        var wantFamily = ${jsxLit(fontFamily)};
        var wantWeight = ${jsxLit(fontWeight)};
        var chosen = null;
        for (var i = 0; i < app.textFonts.length; i++) {
            var f = app.textFonts[i];
            if (f.family === wantFamily && f.style === wantWeight) { chosen = f; break; }
        }
        if (!chosen) {
            // Fallback: family match only.
            for (var j = 0; j < app.textFonts.length; j++) {
                if (app.textFonts[j].family === wantFamily) { chosen = app.textFonts[j]; break; }
            }
        }
        if (!chosen) throw new Error("Font not installed: " + wantFamily);
        var attrs = t.textRange.characterAttributes;
        attrs.textFont = chosen;
        attrs.size = ${safeNum(fontSize, 12)};
        return { applied: "font", object: t.name, font: chosen.name, size: attrs.size };
    `;
    return runJsx(body);
}

export async function setTextColor(objectName, color) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var t = findText(doc, ${jsxLit(objectName)});
        if (!t) throw new Error("Text not found: " + ${jsxLit(objectName)});
        t.textRange.characterAttributes.fillColor = toRgb(${jsxLit(color)});
        return { applied: "textColor", object: t.name };
    `;
    return runJsx(body);
}

export async function applyTextGradient(objectName, colors) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var t = findText(doc, ${jsxLit(objectName)});
        if (!t) throw new Error("Text not found: " + ${jsxLit(objectName)});
        var stops = ${jsxLit(colors)};
        if (!stops || stops.length < 2) throw new Error("Need at least 2 colors");

        var grad = doc.gradients.add();
        grad.type = GradientType.LINEAR;
        var __safety = 0;
        while (grad.gradientStops.length < stops.length && __safety++ < 1000) grad.gradientStops.add();
        if (grad.gradientStops.length < stops.length) throw new Error("Failed to allocate gradient stops");
        for (var i = 0; i < stops.length; i++) {
            var s = grad.gradientStops[i];
            s.color = toRgb(stops[i]);
            s.rampPoint = (i / (stops.length - 1)) * 100;
        }
        var gc = new GradientColor();
        gc.gradient = grad;
        t.textRange.characterAttributes.fillColor = gc;
        return { applied: "textGradient", object: t.name, stops: stops.length };
    `;
    return runJsx(body);
}
