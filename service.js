const Service = require("node-windows").Service;
const path = require("path");

// Absolute path to your main file
const scriptPath = path.join(__dirname, "index.js");

const svc = new Service({
  name: "PositiQ Printer Agent",
  description: "Background service for processing print jobs and generating PDFs",
  script: scriptPath,

  // Optional but recommended:
  maxRestarts: 5,
  wait: 2,
  grow: 0.5,
});

// Log events
svc.on("install", () => {
  console.log("Service installed");
  svc.start();
});

svc.on("alreadyinstalled", () => {
  console.log("Service already installed");
});

svc.on("start", () => {
  console.log("Service started");
});

svc.on("error", (err) => {
  console.error("Service error:", err);
});

// Install service
svc.install();
