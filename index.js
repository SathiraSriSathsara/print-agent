const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const { print, getPrinters } = require("pdf-to-printer");

function getResourcePath(relativePath) {
  if (process.pkg) {
    // inside pkg exe
    return path.join(path.dirname(process.execPath), relativePath);
  } else {
    // normal Node.js
    return path.join(__dirname, relativePath);
  }
}

const QUEUE = path.join(__dirname, "queue");
const OUTPUT = path.join(__dirname, "output");
const TEMPLATE_DIR = getResourcePath("templates");
const TEMPLATE_CONFIG = JSON.parse(fs.readFileSync(getResourcePath("template-config.json"), "utf8"));

async function processJob(filePath) {
  console.log("🧾 New job:", filePath);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));

  const templateKey = json.template || "receipt";

  if (!TEMPLATE_CONFIG[templateKey]) {
    throw new Error(`Unknown template: ${templateKey}`);
  }

  const templateInfo = TEMPLATE_CONFIG[templateKey];
  const templatePath = path.join(TEMPLATE_DIR, templateInfo.file);

  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const compiled = Handlebars.compile(templateHtml);
  const html = compiled(json);

  const now = new Date();
  const currentDate = now.toISOString().split("T")[0];
  const currentTime = now.toTimeString().split(" ")[0].replace(/:/g, "-");

  const invoiceNo = json.invoiceNo || `unknown-${Date.now()}`;
  const safeName = invoiceNo.replace(/[^a-z0-9-_]/gi, "_");
  const finalPdfPath = path.join(
    OUTPUT,
    `${safeName}-${currentDate}-${currentTime}.pdf`
  );

  const shouldPrint = json.print !== false; // default = true
  const shouldSavePDF = json.savePDF === true;

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  // Always generate PDF first (temp)
  const tempPdfPath = path.join(OUTPUT, `.__temp_${Date.now()}.pdf`);
  const pdfOptions = { path: tempPdfPath };

  if (templateInfo.format) {
    pdfOptions.format = templateInfo.format; // A4, Letter, etc
  } else if (templateInfo.width) {
    pdfOptions.width = templateInfo.width;
    // DO NOT set height at all
  }

  await page.pdf(pdfOptions);

  await browser.close();

  let printed = false;

  // Try printing only if allowed
  if (shouldPrint) {
    try {
      if (json.printerName) {
        const printers = await getPrinters();
        const exists = printers.some((p) => p.name === json.printerName);
        if (!exists) throw new Error("Printer not found");
      }

      console.log("🖨 Printing...");
      await print(
        tempPdfPath,
        json.printerName ? { printer: json.printerName } : undefined
      );
      printed = true;
      console.log("✅ Printed successfully");
    } catch (err) {
      console.warn("⚠️ Print failed:", err.message);
    }
  } else {
    console.log("⏭️ Print skipped (print=false)");
  }

  // Decide whether PDF must be saved
  const mustSavePdf = shouldSavePDF || !printed;

  if (mustSavePdf) {
    fs.renameSync(tempPdfPath, finalPdfPath);
    console.log("💾 PDF saved:", finalPdfPath);
  } else {
    fs.unlinkSync(tempPdfPath);
    console.log("🧹 Temp PDF removed");
  }

  fs.unlinkSync(filePath);
  console.log("🧹 Job cleaned\n");
}

chokidar.watch(QUEUE).on("add", processJob);
console.log("🟢 Printer Agent Running...");
