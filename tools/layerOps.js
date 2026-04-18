import { runJsx, jsxLit, safeNum } from "../bridge.js";

const HELPERS = `
    function requireDoc() {
        if (app.documents.length === 0) throw new Error("No open document");
        return app.activeDocument;
    }
    function findItemByName(doc, name) {
        function walk(container) {
            for (var i = 0; i < container.pageItems.length; i++) {
                var it = container.pageItems[i];
                if (it.name === name) return it;
            }
            for (var j = 0; j < container.layers.length; j++) {
                var hit = walk(container.layers[j]);
                if (hit) return hit;
            }
            return null;
        }
        return walk(doc);
    }
    function toRgb(c) {
        // c can be [r,g,b] 0-255 or "#rrggbb" / "#rgb"
        var r, g, b;
        if (typeof c === "string") {
            var s = c.charAt(0) === "#" ? c.substring(1) : c;
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

export async function getLayers() {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        function dump(layer) {
            var items = [];
            for (var i = 0; i < layer.pageItems.length; i++) {
                var it = layer.pageItems[i];
                items.push({ name: it.name || "(unnamed)", type: it.typename });
            }
            var sub = [];
            for (var j = 0; j < layer.layers.length; j++) sub.push(dump(layer.layers[j]));
            return { name: layer.name, visible: layer.visible, locked: layer.locked, items: items, sublayers: sub };
        }
        var out = [];
        for (var k = 0; k < doc.layers.length; k++) out.push(dump(doc.layers[k]));
        return out;
    `;
    return runJsx(body);
}

export async function selectObject(name) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(name)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(name)});
        doc.selection = null;
        it.selected = true;
        return { selected: it.name, type: it.typename };
    `;
    return runJsx(body);
}

export async function applyGradient(objectName, colors, angle = 0) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});

        var stops = ${jsxLit(colors)};
        if (!stops || stops.length < 2) throw new Error("Need at least 2 colors");

        var grad = doc.gradients.add();
        grad.type = GradientType.LINEAR;
        // Default gradient has 2 stops; add more if needed.
        var __safety = 0;
        while (grad.gradientStops.length < stops.length && __safety++ < 1000) grad.gradientStops.add();
        if (grad.gradientStops.length < stops.length) throw new Error("Failed to allocate gradient stops");
        for (var i = 0; i < stops.length; i++) {
            var s = grad.gradientStops[i];
            s.color = toRgb(stops[i]);
            s.rampPoint = (i / (stops.length - 1)) * 100;
            s.midPoint = 50;
        }
        var gc = new GradientColor();
        gc.gradient = grad;
        gc.angle = ${safeNum(angle, 0)};
        it.fillColor = gc;
        return { applied: "gradient", object: it.name, stops: stops.length };
    `;
    return runJsx(body);
}

export async function applyDropShadow(objectName, opacity = 75, xOffset = 7, yOffset = 7, blur = 5) {
    // Illustrator exposes drop shadow via the LiveEffect XML API.
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});
        var xml = '<LiveEffect name="Adobe Drop Shadow">'
          + '<Dict data="'
          + 'R mode 0 '
          + 'R opacity ${safeNum(opacity, 75) / 100} '
          + 'R dx ${safeNum(xOffset, 7)} '
          + 'R dy ${safeNum(yOffset, 7)} '
          + 'R blur ${safeNum(blur, 5)} '
          + 'B csrc 1 '
          + 'R color-R 0 R color-G 0 R color-B 0 '
          + '"/></LiveEffect>';
        it.applyEffect(xml);
        return { applied: "dropShadow", object: it.name };
    `;
    return runJsx(body);
}

export async function applyInnerGlow(objectName, color = "#ffffff", opacity = 75, blur = 5) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});
        var c = toRgb(${jsxLit(color)});
        var xml = '<LiveEffect name="Adobe Inner Glow">'
          + '<Dict data="'
          + 'R mode 0 '
          + 'R opacity ${safeNum(opacity, 75) / 100} '
          + 'R blur ${safeNum(blur, 5)} '
          + 'R color-R ' + (c.red/255) + ' '
          + 'R color-G ' + (c.green/255) + ' '
          + 'R color-B ' + (c.blue/255) + ' '
          + 'B edge 1 '
          + '"/></LiveEffect>';
        it.applyEffect(xml);
        return { applied: "innerGlow", object: it.name };
    `;
    return runJsx(body);
}

export async function setStroke(objectName, color, width) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});
        it.stroked = true;
        it.strokeColor = toRgb(${jsxLit(color)});
        it.strokeWidth = ${safeNum(width, 1)};
        return { applied: "stroke", object: it.name, width: it.strokeWidth };
    `;
    return runJsx(body);
}
