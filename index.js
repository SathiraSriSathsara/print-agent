const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer-core"); // use puppeteer-core for exe
const { print, getPrinters } = require("pdf-to-printer");

// Utility to get paths compatible with pkg exe
function getResourcePath(relativePath) {
  return process.pkg
    ? path.join(path.dirname(process.execPath), relativePath)
    : path.join(__dirname, relativePath);
}

// Directories
const QUEUE = getResourcePath("queue");
const OUTPUT = getResourcePath("output");

// Ensure folders exist
[QUEUE, OUTPUT].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Load templates and printers
const TEMPLATE_DIR = getResourcePath("templates");
const TEMPLATE_CONFIG = JSON.parse(
  fs.readFileSync(getResourcePath("template-config.json"), "utf8")
);
const PRINTERS = fs.existsSync(getResourcePath("printers.json"))
  ? JSON.parse(fs.readFileSync(getResourcePath("printers.json"), "utf8"))
  : {};

async function processJob(filePath) {
  console.log("🧾 New job:", filePath);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // Template selection
  const templateKey = json.template || "receipt";
  if (!TEMPLATE_CONFIG[templateKey]) {
    console.error(`Unknown template: ${templateKey}`);
    fs.unlinkSync(filePath);
    return;
  }
  const templateInfo = TEMPLATE_CONFIG[templateKey];
  const templatePath = path.join(TEMPLATE_DIR, templateInfo.file);
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  const compiled = Handlebars.compile(templateHtml);
  const html = compiled(json);

  // File naming
  const now = new Date();
  const currentDate = now.toISOString().split("T")[0];
  const currentTime = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  const invoiceNo = json.invoiceNo || `unknown-${Date.now()}`;
  const safeName = invoiceNo.replace(/[^a-z0-9-_]/gi, "_");
  const finalPdfPath = path.join(
    OUTPUT,
    `${safeName}-${currentDate}-${currentTime}.pdf`
  );

  const shouldPrint = json.print !== false; // default true
  const shouldSavePDF = json.savePDF === true;

  // Launch Puppeteer using system-installed Chrome
  const browser = await puppeteer.launch({
    executablePath:
      json.chromePath ||
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  // PDF generation
  const tempPdfPath = path.join(OUTPUT, `.__temp_${Date.now()}.pdf`);
  const pdfOptions = { path: tempPdfPath };
  if (templateInfo.format) pdfOptions.format = templateInfo.format;
  if (templateInfo.width) pdfOptions.width = templateInfo.width;
  await page.pdf(pdfOptions);
  await browser.close();

  let printed = false;

  if (shouldPrint) {
    try {
      let printerName = json.printerName
        ? PRINTERS[json.printerName] || json.printerName
        : undefined;

      if (printerName) {
        const printers = await getPrinters();
        const exists = printers.some((p) => p.name === printerName);
        if (!exists) throw new Error("Printer not found");
      }

      console.log("🖨 Printing...");
      await print(tempPdfPath, printerName ? { printer: printerName } : undefined);
      printed = true;
      console.log("✅ Printed successfully");
    } catch (err) {
      console.warn("⚠️ Print failed:", err.message);
    }
  } else {
    console.log("⏭️ Print skipped (print=false)");
  }

  // Save PDF if required or printing failed
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

// Watch queue folder
chokidar.watch(QUEUE).on("add", processJob);
console.log("🟢 Printer Agent Running...");
