// Compatibility probe for the Typst compiler this package links against.
//
// The typst.ts packages are peer dependencies, so a consumer can select the
// Typst release it wants. That flexibility means a silent compiler change
// would only show up as odd output in a build. This probe pins the two
// contracts the package depends on:
//
//   1. the embedded Typst version, and
//   2. the rich-SVG markers (`typst-doc`, `typst-text`) that the stylesheet
//      and the internal-link jump behaviour rely on.
//
// It uses only Node built-ins and plain assertions, so it can run in CI
// without a test framework.
//
// Usage: node scripts/verify-typst.mjs
//
// Set EXPECTED_TYPST_VERSION to check a specific Typst release, e.g.
// EXPECTED_TYPST_VERSION=0.15 node scripts/verify-typst.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

let NodeCompiler;
try {
    ({ NodeCompiler } = require("@myriaddreamin/typst-ts-node-compiler"));
} catch (error) {
    console.error(
        "Cannot load @myriaddreamin/typst-ts-node-compiler.\n" +
        "It is a peer dependency: install the typst.ts packages matching the\n" +
        "Typst release you want, then re-run this probe.\n" +
        `Original error: ${error.message}`,
    );
    process.exit(1);
}

const expectedVersion = process.env.EXPECTED_TYPST_VERSION;

// The compiler resolves the entry file against its workspace root, which
// defaults to the package directory. The probe writes inside the package so
// the entry file is inside that workspace.
const workDir = await mkdtemp(join(packageRoot, ".typst-probe-"));

async function compile(source, compiler) {
    const filePath = join(workDir, `probe-${Math.random().toString(36).slice(2)}.typ`);
    await writeFile(filePath, source, "utf8");
    const doc = compiler.compile({ mainFilePath: filePath });
    if (!doc?.result) {
        doc?.printDiagnostics?.();
        throw new Error(`The compiler returned no document for:\n${source}`);
    }
    return doc.result;
}

try {
    // --- 1. Embedded Typst version -----------------------------------------

    const versionCompiler = await NodeCompiler.create();
    const versionDoc = await compile(
        "#metadata(sys.version)<version>",
        versionCompiler,
    );
    const versionData = versionCompiler.query(versionDoc, { selector: "<version>" });

    assert.ok(
        versionData?.length > 0,
        "The compiler returned no <version> metadata. The probe source may " +
        "have changed shape in a newer Typst release.",
    );

    const version = String(versionData[0].value);
    console.log(`Embedded Typst version: ${version}`);

    if (expectedVersion) {
        assert.ok(
            version.includes(expectedVersion),
            `Expected Typst ${expectedVersion}, but the compiler reports ${version}.`,
        );
    }

    // --- 2. Rich SVG markers ------------------------------------------------

    const svgCompiler = await NodeCompiler.create();
    const svgDoc = await compile(
        "= Heading\n\nSome body text.\n",
        svgCompiler,
    );
    const svg = svgCompiler.svg(svgDoc);

    assert.ok(
        svg.includes("typst-doc"),
        "The SVG output has no `typst-doc` marker. The package stylesheet and " +
        "the internal-link jump behaviour key off it.",
    );
    assert.ok(
        svg.includes("typst-text"),
        "The SVG output has no `typst-text` marker. Typst 0.15 removed classes " +
        "from the plain SVG exporter; if this fails, check whether the compiler " +
        "is still emitting the rich SVG layer.",
    );

    console.log("Rich SVG markers present: typst-doc, typst-text");

    // --- 3. Mathematics survives the HTML export ----------------------------

    // Typst 0.14 dropped mathematics from its HTML export entirely: an
    // equation compiled to an empty element, so a page full of maths
    // rendered as prose with the equations silently missing. Typst 0.15
    // emits MathML instead. This check fails loudly rather than letting
    // that regression reach a built site.

    const htmlCompiler = await NodeCompiler.create();
    const mathFile = join(workDir, "math.typ");
    await writeFile(mathFile, "Before $x^2$ after.\n", "utf8");
    const htmlDoc = htmlCompiler.compileHtml({ mainFilePath: mathFile });
    assert.ok(
        htmlDoc?.result,
        "The compiler returned no HTML document. The probe source may have " +
        "changed shape in a newer Typst release.",
    );
    const htmlOut = htmlCompiler.tryHtml(htmlDoc.result);
    assert.ok(
        htmlOut?.result,
        "The compiler produced no HTML output for a document containing " +
        "mathematics.",
    );

    const hast = htmlOut.result.hast();
    const tagNames = [];
    const collect = (node) => {
        if (node.tagName) tagNames.push(node.tagName);
        for (const child of node.children ?? []) collect(child);
    };
    collect(hast);

    assert.ok(
        tagNames.includes("math"),
        "The HTML export contains no <math> element. Typst 0.14 dropped " +
        "mathematics from its HTML export; 0.15 emits MathML. A Typst " +
        "release that renders maths as empty elements would make a page of " +
        "equations render as prose with the equations missing.",
    );

    console.log("Mathematics survives the HTML export: <math> present");
    console.log("Typst compatibility probe passed.");
} finally {
    await rm(workDir, { recursive: true, force: true });
}
