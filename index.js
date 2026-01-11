const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer-core");
const { print, getPrinters } = require("pdf-to-printer");

// Logging helper
function log(...args) {
  try {
    const logLine = `[${new Date().toISOString()}] ${args.join(" ")}`;
    console.log(logLine);
    fs.appendFileSync("agent.log", logLine + "\n");
  } catch (e) {
    console.error("Failed to write log:", e);
  }
}

// Get resource path compatible with pkg
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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log("Created folder:", dir);
  }
});

// Load templates and printers
let TEMPLATE_CONFIG = {};
let PRINTERS = {};
try {
  TEMPLATE_CONFIG = JSON.parse(
    fs.readFileSync(getResourcePath("template-config.json"), "utf8")
  );
  log("Loaded template-config.json");
} catch (e) {
  log("Failed to load template-config.json:", e.message);
}

try {
  PRINTERS = fs.existsSync(getResourcePath("printers.json"))
    ? JSON.parse(fs.readFileSync(getResourcePath("printers.json"), "utf8"))
    : {};
  log("Loaded printers.json");
} catch (e) {
  log("Failed to load printers.json:", e.message);
}

async function processJob(filePath) {
  log("New job detected:", filePath);

  let json;
  try {
    json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    log("Failed to parse JSON:", e.message);
    return;
  }

  const templateKey = json.template || "receipt";

  if (!TEMPLATE_CONFIG[templateKey]) {
    log(`Unknown template: ${templateKey}`);
    fs.unlinkSync(filePath);
    return;
  }

  const templateInfo = TEMPLATE_CONFIG[templateKey];
  const templatePath = path.join(getResourcePath("templates"), templateInfo.file);

  let templateHtml;
  try {
    templateHtml = fs.readFileSync(templatePath, "utf8");
  } catch (e) {
    log("Failed to read template:", templatePath, e.message);
    return;
  }

  const compiled = Handlebars.compile(templateHtml);
  const html = compiled(json);

  const now = new Date();
  const currentDate = now.toISOString().split("T")[0];
  const currentTime = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  const invoiceNo = json.invoiceNo || `unknown-${Date.now()}`;
  const safeName = invoiceNo.replace(/[^a-z0-9-_]/gi, "_");
  const finalPdfPath = path.join(OUTPUT, `${safeName}-${currentDate}-${currentTime}.pdf`);

  const shouldPrint = json.print !== false;
  const shouldSavePDF = json.savePDF === true;

  // Puppeteer launch
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath:
        json.chromePath ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      headless: "new",
    });
    log("Launched Puppeteer successfully");
  } catch (e) {
    log("Failed to launch Puppeteer:", e.message);
    fs.unlinkSync(filePath);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

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

        await print(tempPdfPath, printerName ? { printer: printerName } : undefined);
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
  }

  fs.unlinkSync(filePath);
  log("Job cleaned:", filePath);
}

// Watch queue folder
chokidar.watch(QUEUE).on("add", processJob);

log("Printer Agent Running...");
