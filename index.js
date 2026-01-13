const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer-core");
const { print, getPrinters } = require("pdf-to-printer");
const bwipjs = require("bwip-js");

// Determine base folder for exe or Node.js
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

// Folders for queue and output
const QUEUE = path.join(BASE_DIR, "queue");
const OUTPUT = path.join(BASE_DIR, "output");
const TEMPLATE_DIR = path.join(BASE_DIR, "templates");

// Log file path (real disk, not inside exe)
const LOG_FILE = path.join(BASE_DIR, "agent.log");

// Helper function to log to console + file
function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (e) {
    console.error("Failed to write log:", e);
  }
}

// Ensure required folders exist
[QUEUE, OUTPUT, TEMPLATE_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log("Created folder:", dir);
  }
});

// Load template config
let TEMPLATE_CONFIG = {};
try {
  TEMPLATE_CONFIG = JSON.parse(
    fs.readFileSync(path.join(BASE_DIR, "template-config.json"), "utf8")
  );
  log("Loaded template-config.json");
} catch (e) {
  log("Failed to load template-config.json:", e.message);
}

// Load printers.json if exists
let PRINTERS = {};
try {
  const printersPath = path.join(BASE_DIR, "printers.json");
  if (fs.existsSync(printersPath)) {
    PRINTERS = JSON.parse(fs.readFileSync(printersPath, "utf8"));
    log("Loaded printers.json");
  }
} catch (e) {
  log("Failed to load printers.json:", e.message);
}

// Main job processor
async function processJob(filePath) {
  log("New job detected:", filePath);

  let json;
  try {
    json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    log("Failed to parse JSON:", e.message);
    fs.unlinkSync(filePath);
    return;
  }

  const templateKey = json.template || "receipt";

  if (!TEMPLATE_CONFIG[templateKey]) {
    log(`Unknown template: ${templateKey}`);
    fs.unlinkSync(filePath);
    return;
  }

  const templateInfo = TEMPLATE_CONFIG[templateKey];
  const templatePath = path.join(TEMPLATE_DIR, templateInfo.file);

  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128", // Barcode type
      text: json.invoiceNo, // Value
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: "center",
    });

    json.barcodeImage = `data:image/png;base64,${png.toString("base64")}`;
  } catch (e) {
    log("Barcode generation failed:", e.message);
  }

  let templateHtml;
  try {
    templateHtml = fs.readFileSync(templatePath, "utf8");
  } catch (e) {
    log("Failed to read template:", templatePath, e.message);
    fs.unlinkSync(filePath);
    return;
  }

  const compiled = Handlebars.compile(templateHtml);
  json.year = new Date().getFullYear();
  json.companyNumber = json.companyNumber || "076 829 0274";
  json.barcode = json.invoiceNo;
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

  // Launch Puppeteer
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      // For pkg exe, user may need to provide Chrome path in JSON
      executablePath:
        json.chromePath ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    log("Puppeteer launched successfully");
  } catch (e) {
    log("Failed to launch Puppeteer:", e.message);
    fs.unlinkSync(filePath);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // PDF generation
    const tempPdfPath = path.join(OUTPUT, `.__temp_${Date.now()}.pdf`);
    const pdfOptions = { path: tempPdfPath };

    if (templateInfo.format) pdfOptions.format = templateInfo.format;
    if (templateInfo.width) pdfOptions.width = templateInfo.width;

    await page.pdf(pdfOptions);
    await browser.close();
    log("PDF generated successfully:", tempPdfPath);

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

        await print(
          tempPdfPath,
          printerName ? { printer: printerName } : undefined
        );
        printed = true;
        log("Printed successfully on:", printerName || "default printer");
      } catch (err) {
        log("Print failed:", err.message);
      }
    } else {
      log("Print skipped (print=false)");
    }

    const mustSavePdf = shouldSavePDF || !printed;
    if (mustSavePdf) {
      fs.renameSync(tempPdfPath, finalPdfPath);
      log("PDF saved:", finalPdfPath);
    } else {
      fs.unlinkSync(tempPdfPath);
      log("Temp PDF removed");
    }
  } catch (e) {
    log("Job failed:", e.message);
    if (browser) await browser.close();
  }

  fs.unlinkSync(filePath);
  log("Job cleaned:", filePath);
}

// Watch the queue folder
chokidar.watch(QUEUE).on("add", processJob);

log("🟢 Printer Agent Running...");
