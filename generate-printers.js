const { getPrinters } = require("pdf-to-printer");
const fs = require("fs");

async function generatePrintersJson() {
  const printers = await getPrinters();

  console.log("Detected printers:");
  printers.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name}`);
  });

  // Map friendly names (you can edit this)
  const printersJson = {
    pos: printers.find(p => p.name.toLowerCase().includes("tm"))?.name || "",
    office: printers.find(p => p.name.toLowerCase().includes("hp"))?.name || "",
    kitchen: printers.find(p => p.name.toLowerCase().includes("epson"))?.name || ""
  };

  fs.writeFileSync("printers.json", JSON.stringify(printersJson, null, 2));
  console.log("\n✅ printers.json generated:");
  console.log(printersJson);
}

generatePrintersJson().catch(console.error);
