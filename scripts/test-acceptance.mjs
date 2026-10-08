// End-to-end acceptance scenarios A01–A15 of PLAN_IMPLEMENTACION.md §18.
// Every criterion of the plan is asserted explicitly and reported with its
// evidence, so the checklist can be closed from a real run (Inkscape 1.4.4).
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { deflateSync, crc32 } from "node:zlib";
import { comparePngVisual, decodePngRgba } from "../dist/export/index.js";

import { serverEntry } from "./lib/server-entry.mjs";

const parent = await mkdtemp(join(tmpdir(), "inkscape-mcp-acceptance-"));
const workspaceRoot = join(parent, "workspace");
await mkdir(workspaceRoot);
const results = [];
const check = (id, ok, evidence) =>
  results.push({ evidence: String(evidence ?? ""), id, ok: Boolean(ok) });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const at = (relativePath) => join(workspaceRoot, relativePath);
const revision = async (relativePath) =>
  sha256(await readFile(at(relativePath)));
const text = (result) =>
  (result.content ?? []).map((item) => item.text ?? "").join("\n");

async function startClient() {
  const transport = new StdioClientTransport({
    args: [serverEntry, "--workspace-root", workspaceRoot],
    command: process.execPath,
    cwd: process.cwd(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  const client = new Client({ name: "acceptance", version: "1.0.0" });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}
const primary = await startClient();
const secondary = await startClient();
const client = primary.client;
async function call(name, args, target = client) {
  const result = await target.callTool({ arguments: args, name });
  if (result.isError) throw new Error(`${name} failed: ${text(result)}`);
  return result.structuredContent;
}
async function failure(name, args, target = client) {
  const result = await target.callTool({ arguments: args, name });
  return result.isError ? text(result) : undefined;
}
async function scenario(name, body) {
  try {
    await body();
  } catch (error) {
    check(`${name} (escenario)`, false, error.message);
  }
}

function png(width, height, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 3, Buffer.from(rgb)),
  ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const pixel = (decoded, x, y) => [
  ...decoded.rgba.subarray(
    (y * decoded.width + x) * 4,
    (y * decoded.width + x) * 4 + 4,
  ),
];
const inkscapeProcessCount = () => {
  const output = spawnSync(
    "tasklist",
    ["/FI", "IMAGENAME eq inkscape.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true },
  ).stdout;
  return output.split(/\r?\n/u).filter((line) => line.includes("inkscape"))
    .length;
};

const workspaceId = (await call("workspace_list", {})).workspaces[0].id;

try {
  // A01 — Doctor sobre la instalación actual.
  await scenario("A01", async () => {
    const status = await call("inkscape_status", {});
    const doctor = JSON.parse(
      execFileSync(process.execPath, [serverEntry, "--doctor", "--json"], {
        encoding: "utf8",
        windowsHide: true,
      }),
    );
    check(
      "A01.1 Detecta versión/build",
      /^1\.4\.4 \([0-9a-f]+, \d{4}-\d{2}-\d{2}\)$/u.test(
        status.inkscape?.version ?? "",
      ),
      status.inkscape?.version,
    );
    check(
      "A01.2 Reporta install kind MSIX",
      status.inkscape?.installKind === "msix" &&
        doctor.inkscape?.installKind === "msix",
      `status=${status.inkscape?.installKind} doctor=${doctor.inkscape?.installKind}`,
    );
    check(
      "A01.3 Reporta inputs, outputs base, flags y acciones",
      doctor.capabilities.inputTypes.includes("svg") &&
        doctor.capabilities.inputTypes.includes("pdf") &&
        doctor.pngExportProbe?.available === true &&
        doctor.capabilities.helpOptions.includes("--export-type") &&
        doctor.capabilities.actionCount > 0 &&
        status.actionCount === doctor.capabilities.actionCount,
      `inputs=${doctor.capabilities.inputTypes.length} flags=${doctor.capabilities.helpOptions.length} actions=${status.actionCount} pngProbe=${doctor.pngExportProbe?.available}`,
    );
    const serialized = JSON.stringify({ doctor, status });
    check(
      "A01.4 Redacta la ruta en la respuesta MCP",
      status.securityPosture.pathsRedacted === true &&
        !/[A-Za-z]:\\|WindowsApps|\\\\/u.test(serialized),
      `pathsRedacted=${status.securityPosture.pathsRedacted}; sin rutas absolutas en status/doctor`,
    );
  });

  // A02 — Crear A4 y exportar PNG para impresión.
  await scenario("A02", async () => {
    await call("document_create", {
      outputPath: "a02.svg",
      preset: "a4-portrait",
      workspaceId,
    });
    const before = await revision("a02.svg");
    const spec = (background, path) => ({
      area: { kind: "page" },
      background,
      format: "png",
      size: { dpi: 300, mode: "dpi" },
      source: { expectedRevision: before, path: "a02.svg" },
      target: { kind: "file", overwrite: false, path },
    });
    const batch = await call("document_export_batch", {
      mode: "all_or_nothing",
      specs: [
        spec({ mode: "transparent" }, "a02-transparent.png"),
        spec({ color: "#ffffff", mode: "solid", opacity: 1 }, "a02-white.png"),
      ],
      workspaceId,
    });
    const inspected = await call("document_inspect", {
      path: "a02.svg",
      workspaceId,
    });
    const master = await readFile(at("a02.svg"), "utf8");
    check(
      "A02.1 SVG maestro sigue editable",
      (await revision("a02.svg")) === before &&
        /<svg\b/u.test(master) &&
        !/<image\b/u.test(master),
      "maestro sin cambios (mismo SHA-256) y sin rasterizar",
    );
    check(
      "A02.2 Tamaño físico es 210 × 297 mm",
      inspected.width === "210mm" && inspected.height === "297mm",
      `${inspected.width} × ${inspected.height}`,
    );
    const variants = batch.manifest.variants;
    const hashesMatch = await Promise.all(
      variants.map(
        async (variant) =>
          sha256(await readFile(at(variant.outputPath))) === variant.revision,
      ),
    );
    check(
      "A02.3 Manifest incluye revision/version/hash/dimensiones",
      batch.manifest.inkscapeVersion?.startsWith("1.4.4") &&
        batch.manifest.source.expectedRevision === before &&
        hashesMatch.every(Boolean) &&
        variants.every(
          (variant) => variant.width === 2480 && variant.height === 3508,
        ),
      `version=${batch.manifest.inkscapeVersion}; variantes ${variants.map((v) => `${v.width}×${v.height}`).join(", ")}; hash=revision del archivo`,
    );
    const transparent = decodePngRgba(
      await readFile(at("a02-transparent.png")),
    );
    const white = decodePngRgba(await readFile(at("a02-white.png")));
    check(
      "A02.4 Transparencia/fondo concuerdan con request",
      pixel(transparent, 5, 5)[3] === 0 &&
        pixel(white, 5, 5).join(",") === "255,255,255,255",
      `transparente α=${pixel(transparent, 5, 5)[3]}; sólido=${pixel(white, 5, 5)}`,
    );
  });

  // A03 — Cambiar lienzo sin mover diseño.
  await scenario("A03", async () => {
    await writeFile(
      at("a03.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" id="root" width="800px" height="600px" viewBox="0 0 800 600"><rect id="a03_box" x="600" y="400" width="150" height="150" fill="#3366cc"/></svg>',
    );
    const before = await revision("a03.svg");
    const resize = (width, height, dryRun, expectedRevision = before) =>
      call("document_resize", {
        dryRun,
        expectedRevision,
        height,
        mode: "page_only",
        path: "a03.svg",
        unit: "px",
        width,
        workspaceId,
      });
    const shrink = await resize(400, 300, true);
    const grow = await resize(1080, 1080, true);
    check(
      "A03.1 Dry run anticipa áreas fuera de página",
      shrink.warnings.includes("CONTENT_OUTSIDE_PAGE") &&
        !grow.warnings.includes("CONTENT_OUTSIDE_PAGE") &&
        (await revision("a03.svg")) === before,
      `400×300 → ${shrink.warnings.join(",")}; 1080×1080 → [${grow.warnings.join(",")}]; documento intacto`,
    );
    const attributesBefore = (
      await call("elements_query", {
        ids: ["a03_box"],
        path: "a03.svg",
        workspaceId,
      })
    ).elements[0].attributes;
    const applied = await resize(1080, 1080, false);
    const attributesAfter = (
      await call("elements_query", {
        ids: ["a03_box"],
        path: "a03.svg",
        workspaceId,
      })
    ).elements[0].attributes;
    check(
      "A03.2 Mutación devuelve diff solo de documento/página",
      applied.diff.addedIds.length === 0 &&
        applied.diff.removedIds.length === 0 &&
        applied.diff.changedIds.every((id) => id === "root") &&
        JSON.stringify(attributesBefore) === JSON.stringify(attributesAfter),
      `changedIds=[${applied.diff.changedIds}]; atributos de a03_box idénticos`,
    );
    const stale = await failure("elements_update", {
      elements: [{ id: "a03_box", style: { fill: "#000000" } }],
      expectedRevision: before,
      path: "a03.svg",
      workspaceId,
    });
    const backups = (await readdir(workspaceRoot)).filter((name) =>
      name.startsWith("a03.svg.bak-"),
    );
    check(
      "A03.3 Backup/revision funcionan",
      applied.backupCreated &&
        backups.length === 1 &&
        applied.revision === (await revision("a03.svg")) &&
        /REVISION_CONFLICT/u.test(stale ?? ""),
      `backup=${backups.length}; revisión nueva coincide; revisión vieja → ${stale?.slice(0, 60)}`,
    );
  });

  // A04 — Escalar contenido con contain/cover.
  await scenario("A04", async () => {
    const landscape =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="400px" viewBox="0 0 800 400"><rect width="800" height="400" fill="#2266aa"/><circle cx="400" cy="200" r="150" fill="#ffcc00"/></svg>';
    for (const name of ["a04.svg", "a04-contain.svg", "a04-cover.svg"])
      await writeFile(at(name), landscape);
    const before = await revision("a04.svg");
    const plan = (mode, anchor) =>
      call("document_resize", {
        anchor,
        dryRun: true,
        expectedRevision: before,
        height: 600,
        mode,
        path: "a04.svg",
        unit: "px",
        width: 600,
        workspaceId,
      });
    const center = await plan("scale_content_contain", "center");
    const corner = await plan("scale_content_contain", "top_left");
    const bottom = await plan("scale_content_contain", "bottom_right");
    const cover = await plan("scale_content_cover", "center");
    const t = (result) => result.predicted.transform;
    check(
      "A04.1 Anchor center y corner pasan fixtures",
      t(center)[0] === 0.75 &&
        t(center)[5] === 150 &&
        t(corner)[5] === 0 &&
        t(bottom)[5] === 300 &&
        t(cover)[0] === 1.5 &&
        t(cover)[4] === -300,
      `contain s=${t(center)[0]} dy(center/top_left/bottom_right)=${t(center)[5]}/${t(corner)[5]}/${t(bottom)[5]}; cover s=${t(cover)[0]} dx=${t(cover)[4]}`,
    );
    check(
      "A04.2 No hay stretch sin permiso",
      [center, corner, bottom, cover].every(
        (result) => t(result)[0] === t(result)[3],
      ) &&
        cover.warnings.includes("CONTENT_MAY_BE_CROPPED") &&
        center.warnings.length === 0,
      `contain/cover escalan uniforme; cover avisa ${cover.warnings}`,
    );
    const previews = [];
    for (const [file, mode] of [
      ["a04-contain.svg", "scale_content_contain"],
      ["a04-cover.svg", "scale_content_cover"],
    ]) {
      const resized = await call("document_resize", {
        anchor: "center",
        expectedRevision: await revision(file),
        height: 600,
        mode,
        path: file,
        unit: "px",
        width: 600,
        workspaceId,
      });
      previews.push(
        await call("document_render_preview", {
          expectedRevision: resized.revision,
          outputPath: file.replace(".svg", ".png"),
          path: file,
          width: 300,
          workspaceId,
        }),
      );
    }
    const contain = decodePngRgba(await readFile(at("a04-contain.png")));
    const coverPng = decodePngRgba(await readFile(at("a04-cover.png")));
    check(
      "A04.3 Preview permite comparar ambos modos",
      previews.every((preview) => preview.width === 300) &&
        comparePngVisual(contain, coverPng).differingPixels > 0 &&
        pixel(contain, 150, 10)[3] === 0 &&
        pixel(coverPng, 150, 10)[3] === 255,
      "contain deja bandas transparentes arriba/abajo; cover llena el cuadrado",
    );
  });

  // A05 — Fit a dibujo con margen físico.
  await scenario("A05", async () => {
    await writeFile(
      at("a05.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect id="a05_box" x="-20" y="-10" width="40" height="30" fill="#55aa55" stroke="#000000" stroke-width="4"/></svg>',
    );
    const before = (
      await call("elements_query", {
        ids: ["a05_box"],
        path: "a05.svg",
        workspaceId,
      })
    ).elements[0].attributes;
    const fit = await call("document_fit_page", {
      expectedRevision: await revision("a05.svg"),
      margins: { bottom: 3, left: 3, right: 3, top: 3 },
      path: "a05.svg",
      scope: "drawing",
      unit: "mm",
      workspaceId,
    });
    check(
      "A05.1 Declara bounds visuales",
      fit.boundsFidelity === "partial" &&
        Math.abs(fit.bounds.width - 44) < 0.1 &&
        Math.abs(fit.bounds.height - 34) < 0.1,
      `bounds ${fit.bounds.width}×${fit.bounds.height} (incluye stroke) fidelity=${fit.boundsFidelity}`,
    );
    const after = (
      await call("elements_query", {
        ids: ["a05_box"],
        path: "a05.svg",
        workspaceId,
      })
    ).elements[0].attributes;
    check(
      "A05.2 No transforma contenido",
      JSON.stringify(before) === JSON.stringify(after) &&
        !("transform" in after),
      "atributos del rectángulo idénticos, sin transform",
    );
    const inspected = await call("document_inspect", {
      path: "a05.svg",
      workspaceId,
    });
    const widthMm = parseFloat(inspected.width);
    const heightMm = parseFloat(inspected.height);
    const box = inspected.viewBox;
    check(
      "A05.3 ViewBox/tamaño físico quedan coherentes",
      Math.abs(widthMm / box.width - heightMm / box.height) < 1e-6 &&
        Math.abs(widthMm - 50) < 0.1 &&
        Math.abs(heightMm - 40) < 0.1 &&
        Math.abs(box.x - (fit.bounds.x - 3)) < 0.1,
      `${inspected.width}×${inspected.height}, viewBox ${box.x},${box.y},${box.width},${box.height}`,
    );
  });

  // A06 — PDF multipágina.
  await scenario("A06", async () => {
    await copyFile(
      resolve("tests", "fixtures", "pdf-subset-three-pages.svg"),
      at("a06.svg"),
    );
    const before = await revision("a06.svg");
    const pages = (
      await call("document_inspect", { path: "a06.svg", workspaceId })
    ).pages;
    const full = await call("export_pdf", {
      expectedRevision: before,
      outputPath: "a06-full.pdf",
      path: "a06.svg",
      workspaceId,
    });
    const status = await call("inkscape_status", {});
    check(
      "A06.1 Flujo completo sin --export-page; sonda frente a drift",
      pages.length === 3 &&
        full.pageCount === 3 &&
        full.strategy === "full_document" &&
        status.inkscape.warnings.length === 0,
      `3 páginas en un PDF (${full.mediaBoxes.map((b) => `${Math.round(b.width)}×${Math.round(b.height)}`).join(", ")}); estrategia ${full.strategy}; sin warnings de drift`,
    );
    const subset = await call("export_pdf", {
      expectedRevision: before,
      outputPath: "a06-subset.pdf",
      pageIds: [pages[0].id, pages[2].id],
      path: "a06.svg",
      workspaceId,
    });
    check(
      "A06.2 Subset 1+3 usa poda temporal y lo declara",
      subset.pageCount === 2 &&
        subset.strategy === "prune_subset" &&
        subset.warnings.includes("PDF_SUBSET_PRUNED") &&
        (await revision("a06.svg")) === before,
      `pageCount=${subset.pageCount} strategy=${subset.strategy} warnings=${subset.warnings}`,
    );
    await mkdir(at("a06-pages-1"));
    await mkdir(at("a06-pages-2"));
    const first = await call("export_pdf_pages", {
      expectedRevision: before,
      outputDirectory: "a06-pages-1",
      path: "a06.svg",
      workspaceId,
    });
    const second = await call("export_pdf_pages", {
      expectedRevision: before,
      outputDirectory: "a06-pages-2",
      path: "a06.svg",
      workspaceId,
    });
    const names = (result) =>
      result.pages.map((page) => page.outputPath.split("/").at(-1));
    check(
      "A06.3 Páginas separadas con nombres deterministas",
      first.pages.length === 3 &&
        JSON.stringify(names(first)) === JSON.stringify(names(second)) &&
        // Documented convention (docs/export-guide.md): page-NNN.pdf by
        // 1-based page order, independent of page IDs.
        first.pages.every((page) =>
          page.outputPath.endsWith(
            `page-${String(page.pageIndex).padStart(3, "0")}.pdf`,
          ),
        ),
      `nombres: ${names(first).join(", ")} (iguales en dos ejecuciones)`,
    );
  });

  // A07 — SVG de intercambio.
  await scenario("A07", async () => {
    await writeFile(
      at("a07.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="200px" height="200px" viewBox="0 0 200 200"><sodipodi:namedview id="view"><sodipodi:guide id="g1" position="100,100" orientation="1,0"/></sodipodi:namedview><metadata id="meta"><title>A07</title></metadata><defs><circle id="a07_src" r="30" fill="#cc3333"/></defs><g id="layer1" inkscape:groupmode="layer" inkscape:label="Capa"><rect id="a07_bg" width="200" height="200" fill="#ffffff"/><use id="a07_use" href="#a07_src" x="100" y="100"/></g></svg>',
    );
    const before = await revision("a07.svg");
    const plain = await call("export_svg", {
      expectedRevision: before,
      flavor: "plain",
      outputPath: "a07-plain.svg",
      path: "a07.svg",
      workspaceId,
    });
    check(
      "A07.1 No sobrescribe el maestro",
      (await revision("a07.svg")) === before && existsSync(at("a07-plain.svg")),
      `maestro intacto; derivado ${plain.byteLength} bytes; warnings=${plain.warnings}`,
    );
    const output = await readFile(at("a07-plain.svg"), "utf8");
    const ids = new Set(
      [...output.matchAll(/\bid="([^"]+)"/gu)].map((m) => m[1]),
    );
    const refs = [...output.matchAll(/href="#([^"]+)"/gu)].map((m) => m[1]);
    check(
      "A07.2 Refs/IDs siguen válidos",
      refs.length > 0 && refs.every((ref) => ids.has(ref)),
      `referencias resueltas: ${refs.join(", ")}`,
    );
    const render = async (path, outputPath) =>
      call("document_render_preview", {
        expectedRevision: await revision(path),
        outputPath,
        path,
        width: 200,
        workspaceId,
      });
    await render("a07.svg", "a07-master.png");
    await render("a07-plain.svg", "a07-derived.png");
    const difference = comparePngVisual(
      decodePngRgba(await readFile(at("a07-derived.png"))),
      decodePngRgba(await readFile(at("a07-master.png"))),
      2,
    );
    check(
      "A07.3 Pasa visual regression",
      difference.differingPixels === 0,
      `píxeles distintos=${difference.differingPixels} (tolerancia 2/canal)`,
    );
  });

  // A08 — Icon pack atómico.
  await scenario("A08", async () => {
    await writeFile(
      at("a08.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="64px" height="64px" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#aa33cc"/></svg>',
    );
    const before = await revision("a08.svg");
    const preset = (outputDirectory) => ({
      name: "icon-pack",
      outputDirectory,
      source: { expectedRevision: before, path: "a08.svg" },
    });
    const pack = await call("document_export_batch", {
      mode: "all_or_nothing",
      preset: preset("icons"),
      workspaceId,
    });
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
    const produced = await Promise.all(
      sizes.map(async (size) => {
        const decoded = decodePngRgba(
          await readFile(at(`icons/icon-${size}.png`)),
        );
        return decoded.width === size && decoded.height === size;
      }),
    );
    check(
      "A08.1 Nombres y tamaños exactos",
      pack.successes.length === 8 &&
        produced.every(Boolean) &&
        pack.manifest.publication === "manifest_commit" &&
        typeof pack.manifest.commitMarker === "string" &&
        existsSync(at(pack.manifest.commitMarker)),
      `icon-{${sizes.join(",")}}.png con píxeles exactos; marker ${pack.manifest.commitMarker}`,
    );
    const job = await call("document_export_batch", {
      delivery: "job",
      mode: "all_or_nothing",
      preset: preset("icons-cancel"),
      workspaceId,
    });
    await call("job_cancel", { jobId: job.jobId, workspaceId });
    let status;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      status = await call("job_get", { jobId: job.jobId, workspaceId });
      if (status.status !== "queued" && status.status !== "running") break;
      await delay(25);
    }
    // Staging temporaries are `*.tmp` files; the commit-marker directory of
    // the earlier successful batch is legitimate published state.
    const leftovers = (
      await readdir(workspaceRoot, { recursive: true })
    ).filter((name) => /\.tmp$/u.test(name));
    const cancelledOutputs = existsSync(at("icons-cancel"))
      ? await readdir(at("icons-cancel"))
      : [];
    check(
      "A08.2 Cancelación limpia staging",
      status.status === "cancelled" &&
        cancelledOutputs.filter((name) => name.endsWith(".png")).length === 0 &&
        leftovers.length === 0,
      `job=${status.status}; PNG publicados=${cancelledOutputs.length}; temporales=${leftovers.length}`,
    );
    await mkdir(at("icons-collide"), { recursive: true });
    await writeFile(at("icons-collide/icon-64.png"), "existing");
    const collision = await failure("document_export_batch", {
      mode: "all_or_nothing",
      preset: preset("icons-collide"),
      workspaceId,
    });
    check(
      "A08.3 Colisión sin overwrite falla antes de publicar",
      collision !== undefined &&
        (await readdir(at("icons-collide"))).join(",") === "icon-64.png" &&
        (await readFile(at("icons-collide/icon-64.png"), "utf8")) ===
          "existing",
      `error: ${collision?.slice(0, 80)}; ningún otro icono publicado`,
    );
    const recovery = spawnSync(
      process.execPath,
      [resolve("scripts", "test-f05-batch-recovery.mjs")],
      { encoding: "utf8", env: process.env, windowsHide: true },
    );
    check(
      "A08.4 Crash injection demuestra garantía y riesgo residual",
      recovery.status === 0,
      `scripts/test-f05-batch-recovery.mjs (inyecta un fallo entre renames y verifica rollback y recibo): exit ${recovery.status}`,
    );
  });

  // A09 — Diseño completo por transacción.
  await scenario("A09", async () => {
    await call("document_create", {
      outputPath: "a09.svg",
      preset: "a4-portrait",
      workspaceId,
    });
    await writeFile(at("a09-logo.png"), png(4, 4, [10, 120, 200]));
    const before = await revision("a09.svg");
    const created = await call("document_apply_operations", {
      expectedRevision: before,
      operations: [
        {
          aliases: { card: "a09_card", curve: "a09_curve", title: "a09_title" },
          elements: [
            { id: "a09_layer", kind: "layer", label: "Diseño" },
            {
              height: 297,
              id: "a09_bg",
              kind: "rect",
              parentId: "a09_layer",
              style: { fill: "#eeeeee" },
              width: 210,
              x: 0,
              y: 0,
            },
            {
              height: 60,
              id: "a09_card",
              kind: "rect",
              parentId: "a09_layer",
              width: 100,
              x: 20,
              y: 20,
            },
            {
              d: "M 20 150 C 60 100 140 200 180 150",
              id: "a09_curve",
              kind: "path",
              parentId: "a09_layer",
              style: { fill: "none", stroke: "#333333" },
            },
            {
              id: "a09_title",
              kind: "text",
              parentId: "a09_layer",
              text: "Hola transacción",
              x: 20,
              y: 140,
            },
            {
              assetPath: "a09-logo.png",
              embedding: "embed",
              height: 30,
              id: "a09_logo",
              kind: "image",
              parentId: "a09_layer",
              width: 30,
              x: 150,
              y: 20,
            },
          ],
          kind: "create",
        },
        {
          alias: "grad",
          kind: "gradient",
          spec: {
            id: "a09_grad",
            kind: "linear",
            stops: [
              { color: "#ff0000", offset: 0 },
              { color: "#0000ff", offset: 1 },
            ],
          },
        },
        {
          gradientId: "@grad",
          kind: "apply_gradient",
          paint: "fill",
          targetIds: ["@card"],
        },
        { kind: "text_path", pathId: "@curve", textId: "@title" },
        { kind: "arrange", request: { action: "front", ids: ["@card"] } },
      ],
      path: "a09.svg",
      workspaceId,
    });
    const svg = await readFile(at("a09.svg"), "utf8");
    check(
      "A09.1 Alias interno enlaza gradiente/text path de la misma llamada",
      /id="a09_card"[^>]*fill="url\(#a09_grad\)"|fill="url\(#a09_grad\)"[^>]*id="a09_card"/u.test(
        svg,
      ) && /<textPath[^>]*href="#a09_curve"/u.test(svg),
      "a09_card → fill url(#a09_grad); a09_title → textPath #a09_curve",
    );
    const afterCreate = await revision("a09.svg");
    const failed = await failure("document_apply_operations", {
      expectedRevision: afterCreate,
      operations: [
        {
          elements: [
            { height: 5, id: "a09_temp", kind: "rect", width: 5, x: 1, y: 1 },
          ],
          kind: "create",
        },
        {
          gradientId: "@missing",
          kind: "apply_gradient",
          paint: "fill",
          targetIds: ["a09_temp"],
        },
      ],
      path: "a09.svg",
      workspaceId,
    });
    check(
      "A09.2 Un fallo intermedio revierte todo",
      failed !== undefined &&
        (await revision("a09.svg")) === afterCreate &&
        !(await readFile(at("a09.svg"), "utf8")).includes("a09_temp"),
      `error: ${failed?.slice(0, 70)}; documento sin a09_temp`,
    );
    const expected = [
      "a09_layer",
      "a09_bg",
      "a09_card",
      "a09_curve",
      "a09_title",
      "a09_logo",
    ];
    const preview = await call("document_render_preview", {
      expectedRevision: afterCreate,
      outputPath: "a09.png",
      path: "a09.svg",
      width: 210,
      workspaceId,
    });
    check(
      "A09.3 Diff resume objetos creados/cambiados",
      expected.every((id) => created.diff.addedIds.includes(id)) &&
        created.operations === 5 &&
        preview.width === 210,
      `addedIds=${created.diff.addedIds.join(",")}; el diseño reabre y renderiza`,
    );
  });

  // A10 — Paths y clipping.
  await scenario("A10", async () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="120px" viewBox="0 0 200 120"><path id="p1" d="M 10 10 H 90 V 90 H 10 Z" fill="#cc0000"/><path id="p2" d="M 50 50 H 130 V 110 H 50 Z" fill="#0000cc"/><image id="img" x="140" y="10" width="50" height="50" href="data:image/png;base64,${png(2, 2, [0, 160, 0]).toString("base64")}"/></svg>`;
    for (const name of ["a10a.svg", "a10b.svg", "a10c.svg"])
      await writeFile(at(name), source);
    const union = async (path) =>
      call("paths_boolean", {
        expectedRevision: await revision(path),
        ids: ["p1", "p2"],
        operation: "union",
        path,
        workspaceId,
      });
    const first = await union("a10a.svg");
    const second = await union("a10b.svg");
    await call("images_crop", {
      clipId: "img_clip",
      expectedRevision: await revision("a10a.svg"),
      height: 25,
      imageId: "img",
      path: "a10a.svg",
      width: 25,
      workspaceId,
      x: 140,
      y: 10,
    });
    const rendered = await call("document_render_preview", {
      expectedRevision: await revision("a10a.svg"),
      outputPath: "a10a.png",
      path: "a10a.svg",
      width: 200,
      workspaceId,
    });
    const decoded = decodePngRgba(await readFile(at("a10a.png")));
    check(
      "A10.1 Geometría/visual pasan fixtures",
      first.revision === second.revision &&
        JSON.stringify(first.diff) === JSON.stringify(second.diff) &&
        pixel(decoded, 70, 70)[3] === 255 &&
        pixel(decoded, 120, 30)[3] === 0 &&
        pixel(decoded, 145, 15)[3] === 255 &&
        pixel(decoded, 185, 55)[3] === 0 &&
        rendered.width === 200,
      `unión determinista (misma revisión); interior opaco, hueco transparente; clip recorta la imagen`,
    );
    const snapshot = await call("document_snapshot", {
      expectedRevision: await revision("a10c.svg"),
      path: "a10c.svg",
      workspaceId,
    });
    await call("paths_boolean", {
      expectedRevision: await revision("a10c.svg"),
      ids: ["p1", "p2"],
      operation: "difference",
      path: "a10c.svg",
      workspaceId,
    });
    await call("document_restore", {
      expectedRevision: await revision("a10c.svg"),
      path: "a10c.svg",
      snapshotId: snapshot.snapshotId,
      workspaceId,
    });
    check(
      "A10.2 Snapshot permite restaurar",
      (await revision("a10c.svg")) === snapshot.revision,
      "tras difference y restore, la revisión vuelve a la del snapshot",
    );
    const exportedPng = await call("export_png", {
      expectedRevision: await revision("a10a.svg"),
      outputPath: "a10a-export.png",
      path: "a10a.svg",
      width: 200,
      workspaceId,
    });
    const exportedPdf = await call("export_pdf", {
      expectedRevision: await revision("a10a.svg"),
      outputPath: "a10a.pdf",
      path: "a10a.svg",
      workspaceId,
    });
    const exportedDecoded = decodePngRgba(
      await readFile(at("a10a-export.png")),
    );
    check(
      "A10.3 Export PNG/PDF conserva resultado",
      comparePngVisual(exportedDecoded, decoded, 2).differingPixels === 0 &&
        exportedPdf.pageCount === 1 &&
        exportedPng.width === 200,
      "PNG exportado idéntico al preview; PDF de 1 página",
    );
  });

  // A11 — Fuentes faltantes.
  await scenario("A11", async () => {
    await writeFile(
      at("a11.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="60px" viewBox="0 0 200 60"><text id="a11_text" x="10" y="40" font-family="Inkscape MCP Missing Font XYZ" font-size="20">Texto editable</text></svg>',
    );
    const before = await revision("a11.svg");
    const fonts = await call("fonts_preflight", {
      path: "a11.svg",
      workspaceId,
    });
    const preflight = await call("document_preflight", {
      path: "a11.svg",
      profile: "print",
      workspaceId,
    });
    const pdf = await call("export_pdf", {
      expectedRevision: before,
      outputPath: "a11.pdf",
      path: "a11.svg",
      workspaceId,
    });
    check(
      "A11.1 No afirma que la fuente se incrustó sin verificar",
      fonts.missingFamilies.includes("Inkscape MCP Missing Font XYZ") &&
        preflight.issues.some((issue) => /FONT/u.test(issue.code)) &&
        !/embed/iu.test(JSON.stringify(pdf)),
      `preflight: ${preflight.issues.map((issue) => issue.code).join(",")}; el resultado PDF no declara incrustación`,
    );
    await call("export_svg", {
      expectedRevision: before,
      flavor: "plain",
      outputPath: "a11-plain.svg",
      path: "a11.svg",
      workspaceId,
    });
    await call("export_svg", {
      expectedRevision: before,
      flavor: "plain",
      outputPath: "a11-paths.svg",
      path: "a11.svg",
      textToPath: true,
      workspaceId,
    });
    check(
      "A11.2 Text-to-path solo ocurre si fue solicitado",
      /<text\b/u.test(await readFile(at("a11-plain.svg"), "utf8")) &&
        !/<text\b/u.test(await readFile(at("a11-paths.svg"), "utf8")),
      "sin textToPath conserva <text>; con textToPath:true no queda <text>",
    );
    check(
      "A11.3 El diseño maestro no pierde texto editable",
      (await revision("a11.svg")) === before &&
        (await readFile(at("a11.svg"), "utf8")).includes(
          ">Texto editable</text>",
        ),
      "maestro intacto con su <text>",
    );
  });

  // A12 — Importación PDF.
  await scenario("A12", async () => {
    const pdfRevision = await revision("a06-full.pdf");
    const importPage = (page, mode, outputPath) =>
      call("document_import_pdf", {
        expectedRevision: pdfRevision,
        manifestPath: `${outputPath}.json`,
        mode,
        outputPath,
        page,
        path: "a06-full.pdf",
        workspaceId,
      });
    const internal = await importPage(1, "internal", "a12-p1.svg");
    const poppler = await importPage(3, "poppler", "a12-p3.svg");
    check(
      "A12.1 Modos interno y Poppler son diferenciables",
      internal.manifest.mode === "internal" &&
        poppler.manifest.mode === "poppler" &&
        Array.isArray(internal.manifest.losses) &&
        internal.manifest.sourceSha256 === pdfRevision,
      `manifest p1 mode=${internal.manifest.mode}, p3 mode=${poppler.manifest.mode}; pérdidas documentadas`,
    );
    const pdf = await readFile(at("a06-full.pdf"));
    await writeFile(
      at("a12-corrupt.pdf"),
      pdf.subarray(0, Math.floor(pdf.length / 3)),
    );
    const corrupt = await failure("document_import_pdf", {
      expectedRevision: await revision("a12-corrupt.pdf"),
      manifestPath: "a12-corrupt.svg.json",
      mode: "internal",
      outputPath: "a12-corrupt.svg",
      page: 1,
      path: "a12-corrupt.pdf",
      workspaceId,
    });
    check(
      "A12.2 Página corrupta falla limpiamente",
      corrupt !== undefined &&
        !existsSync(at("a12-corrupt.svg")) &&
        !existsSync(at("a12-corrupt.svg.json")),
      `error: ${corrupt?.slice(0, 70)}; sin output ni manifest (PDF cifrado no se fabrica aquí: pdf-lib no cifra)`,
    );
    check(
      "A12.3 No se incorpora output parcial al maestro",
      (await revision("a06-full.pdf")) === pdfRevision &&
        internal.outputPath === "a12-p1.svg" &&
        (await revision("a12-p1.svg")) === internal.manifest.outputSha256,
      "el PDF de origen no cambia; cada import publica un SVG nuevo con hash en su manifest",
    );
  });

  // A13 — Defensa de paths/comandos.
  await scenario("A13", async () => {
    await writeFile(
      at("a13.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 20 20"><rect width="20" height="20" fill="#000000"/></svg>',
    );
    const before = await revision("a13.svg");
    const traversal = await failure("export_png", {
      expectedRevision: before,
      outputPath: "..\\fuera.png",
      path: "a13.svg",
      workspaceId,
    });
    const meta = "meta&b;c$(echo pwned)`x` 'q'.png";
    await call("export_png", {
      expectedRevision: before,
      outputPath: meta,
      path: "a13.svg",
      workspaceId,
    });
    check(
      "A13.1 Ningún archivo fuera del root cambia",
      traversal !== undefined &&
        !existsSync(join(parent, "fuera.png")) &&
        (await readdir(parent)).join(",") === "workspace",
      `..\\fuera.png → ${traversal?.slice(0, 60)}`,
    );
    const logs = primary.stderr() + secondary.stderr();
    check(
      "A13.2 Logs no filtran path externo",
      !logs.includes(parent) && !logs.toLowerCase().includes("fuera.png"),
      `stderr de ambos servidores (${logs.length} bytes) sin rutas absolutas ni el destino rechazado`,
    );
    check(
      "A13.3 No se ejecuta comando adicional",
      existsSync(at(meta)) &&
        !(await readdir(workspaceRoot)).some((name) =>
          /^pwned|^x$/u.test(name),
        ),
      `el nombre con metacaracteres se usó literal: "${meta}"`,
    );
  });

  // A14 — Concurrencia/revisión (dos servidores = dos clientes reales).
  await scenario("A14", async () => {
    await writeFile(
      at("a14.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 20 20"><rect id="a14_box" width="20" height="20" fill="#000000"/></svg>',
    );
    const r0 = await revision("a14.svg");
    const update = (target, fill) =>
      target.callTool({
        arguments: {
          elements: [{ id: "a14_box", style: { fill } }],
          expectedRevision: r0,
          path: "a14.svg",
          workspaceId,
        },
        name: "elements_update",
      });
    const [a, b] = await Promise.all([
      update(primary.client, "#ff0000"),
      update(secondary.client, "#00ff00"),
    ]);
    const winners = [a, b].filter((result) => !result.isError);
    const losers = [a, b].filter((result) => result.isError);
    const content = await readFile(at("a14.svg"), "utf8");
    const winnerFill = winners[0] === a ? "#ff0000" : "#00ff00";
    check(
      "A14.1 Locks se liberan en fallo/cancelación",
      winners.length === 1 &&
        losers.length === 1 &&
        /REVISION_CONFLICT/u.test(text(losers[0])),
      `un commit y un ${text(losers[0]).slice(0, 40)}`,
    );
    check(
      "A14.2 No hay archivo truncado",
      content.includes(`fill="${winnerFill}"`) &&
        content.trim().endsWith("</svg>"),
      `el SVG queda completo con el color del ganador (${winnerFill})`,
    );
    const retried = await call(
      "elements_update",
      {
        elements: [{ id: "a14_box", style: { fill: "#0000ff" } }],
        expectedRevision: await revision("a14.svg"),
        path: "a14.svg",
        workspaceId,
      },
      winners[0] === a ? secondary.client : primary.client,
    );
    check(
      "A14.3 El cliente puede reinspeccionar y reintentar",
      retried.revision === (await revision("a14.svg")),
      "el perdedor relee la revisión y su reintento se publica",
    );
    await call("export_png", {
      expectedRevision: await revision("a14.svg"),
      outputPath: "a14.png",
      path: "a14.svg",
      workspaceId,
    });
    const outputRevision = await revision("a14.png");
    const exportAgain = (target, width) =>
      target.callTool({
        arguments: {
          expectedOutputRevision: outputRevision,
          expectedRevision: retried.revision,
          outputPath: "a14.png",
          path: "a14.svg",
          width,
          workspaceId,
        },
        name: "export_png",
      });
    const exports = await Promise.all([
      exportAgain(primary.client, 30),
      exportAgain(secondary.client, 40),
    ]);
    const exportWinners = exports.filter((result) => !result.isError);
    const exportLosers = exports.filter((result) => result.isError);
    check(
      "A14.4 Mismo expectedOutputRevision: un commit y un OUTPUT_REVISION_CONFLICT",
      exportWinners.length === 1 &&
        exportLosers.length === 1 &&
        /OUTPUT_REVISION_CONFLICT/u.test(text(exportLosers[0])),
      `perdedor: ${text(exportLosers[0]).slice(0, 60)}`,
    );
  });

  // A15 — Cancelación de batch.
  await scenario("A15", async () => {
    await call("document_create", {
      outputPath: "a15.svg",
      preset: "a4-portrait",
      workspaceId,
    });
    const source = {
      expectedRevision: await revision("a15.svg"),
      path: "a15.svg",
    };
    await mkdir(at("a15"));
    const baseline = inkscapeProcessCount();
    const job = await call("document_export_batch", {
      delivery: "job",
      mode: "all_or_nothing",
      specs: Array.from({ length: 12 }, (_, index) => ({
        area: { kind: "page" },
        background: { mode: "transparent" },
        format: "png",
        size: { dpi: 300, mode: "dpi" },
        source,
        target: {
          kind: "file",
          overwrite: false,
          path: `a15/out-${index}.png`,
        },
      })),
      workspaceId,
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await call("job_get", { jobId: job.jobId, workspaceId });
      if (
        current.status === "running" &&
        current.progress?.stage === "rendering"
      )
        break;
      await delay(25);
    }
    const cancelled = await call("job_cancel", {
      jobId: job.jobId,
      workspaceId,
    });
    let status;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      status = await call("job_get", { jobId: job.jobId, workspaceId });
      if (status.status !== "queued" && status.status !== "running") break;
      await delay(25);
    }
    let orphans = inkscapeProcessCount() - baseline;
    for (let attempt = 0; attempt < 40 && orphans > 0; attempt += 1) {
      await delay(250);
      orphans = inkscapeProcessCount() - baseline;
    }
    check(
      "A15.1 No hay procesos huérfanos",
      status.status === "cancelled" && orphans <= 0,
      `job ${cancelled.status} → ${status.status}; procesos inkscape extra=${Math.max(0, orphans)}`,
    );
    let manifestReadable = true;
    try {
      await client.readResource({ uri: job.manifestUri });
    } catch {
      manifestReadable = false;
    }
    const published = existsSync(at("a15"))
      ? (await readdir(at("a15"))).filter((name) => name.endsWith(".png"))
      : [];
    check(
      "A15.2 No hay resource links a parciales",
      !manifestReadable && published.length === 0,
      `manifest del job ${manifestReadable ? "legible" : "retirado"}; PNG publicados=${published.length}`,
    );
    const again = await call("job_cancel", { jobId: job.jobId, workspaceId });
    check(
      "A15.3 Cancelar de nuevo es idempotente",
      again.status === "cancelled",
      `segundo job_cancel → ${again.status}`,
    );
  });
} finally {
  await primary.client.close();
  await secondary.client.close();
  await rm(parent, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 50,
  });
}

const width = Math.max(...results.map((result) => result.id.length));
for (const result of results)
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${result.id.padEnd(width)}  ${result.evidence}\n`,
  );
const failed = results.filter((result) => !result.ok);
process.stdout.write(
  `\nAcceptance criteria: ${results.length - failed.length}/${results.length} passed.\n`,
);
if (failed.length > 0) process.exitCode = 1;
