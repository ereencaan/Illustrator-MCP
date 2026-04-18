import { runJsx, jsxLit, safeNum } from "../bridge.js";

const HELPERS = `
    function requireDoc() {
        if (app.documents.length === 0) throw new Error("No open document");
        return app.activeDocument;
    }
    function findItemByName(doc, name) {
        function walk(container) {
            for (var i = 0; i < container.pageItems.length; i++) {
                if (container.pageItems[i].name === name) return container.pageItems[i];
            }
            for (var j = 0; j < container.layers.length; j++) {
                var hit = walk(container.layers[j]);
                if (hit) return hit;
            }
            return null;
        }
        var hit = walk(doc);
        if (hit) return hit;
        for (var k = 0; k < doc.textFrames.length; k++) {
            if (doc.textFrames[k].name === name) return doc.textFrames[k];
        }
        return null;
    }
`;

/**
 * Apply a raw Illustrator LiveEffect by type id.
 * Well-known ids: "Adobe Drop Shadow", "Adobe Gaussian Blur", "Adobe Inner Glow",
 * "Adobe Outer Glow", "Adobe Feather", "Adobe Round Corners", etc.
 * params is an object of {key: value} pairs inserted into the effect Dict.
 * Value rules: numbers → "R key v", booleans → "B key 0|1", strings → "S key (val)".
 */
export async function applyAppearanceEffect(objectName, effectType, params = {}) {
    const pieces = [];
    for (const [k, v] of Object.entries(params)) {
        if (typeof v === "number") pieces.push(`R ${k} ${v}`);
        else if (typeof v === "boolean") pieces.push(`B ${k} ${v ? 1 : 0}`);
        else pieces.push(`S ${k} (${String(v)})`);
    }
    const dict = pieces.join(" ");
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});
        var xml = '<LiveEffect name=${jsxLit(effectType).replace(/'/g, "\\'")}>'
            + '<Dict data="${dict}"/>'
            + '</LiveEffect>';
        it.applyEffect(xml);
        return { applied: "appearanceEffect", object: it.name, effect: ${jsxLit(effectType)} };
    `;
    return runJsx(body);
}

export async function setOpacity(objectName, opacity) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});
        it.opacity = ${safeNum(opacity, 100)};
        return { applied: "opacity", object: it.name, opacity: it.opacity };
    `;
    return runJsx(body);
}

export async function addGaussianBlur(objectName, radius = 5) {
    const body = `
        ${HELPERS}
        var doc = requireDoc();
        var it = findItemByName(doc, ${jsxLit(objectName)});
        if (!it) throw new Error("Object not found: " + ${jsxLit(objectName)});
        var xml = '<LiveEffect name="Adobe Gaussian Blur">'
          + '<Dict data="R radius ${safeNum(radius, 5)}"/>'
          + '</LiveEffect>';
        it.applyEffect(xml);
        return { applied: "gaussianBlur", object: it.name, radius: ${safeNum(radius, 5)} };
    `;
    return runJsx(body);
}
