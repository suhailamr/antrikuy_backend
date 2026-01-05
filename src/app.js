require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const cron = require("node-cron");

const queueController = require("./controllers/queueController");

const schoolRoutes = require("./routes/schoolRoutes");
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const queueRoutes = require("./routes/queueRoutes");
const authRoutes = require("./routes/authRoutes");
const testRoutes = require("./routes/testRoutes");

// 🔥🔥🔥 TAMBAHAN: Jangan lupa import ini! 🔥🔥🔥
const superAdminRoutes = require("./routes/superAdminRoutes");

const app = express();
const PORT = process.env.PORT || 3300;
const HOST = "0.0.0.0";

app.use(cors());
app.use(express.json());

app.use("/api/schools", schoolRoutes);
app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/test", testRoutes);

app.use("/api/super-admin", superAdminRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend Antrikuy aktif. Gunakan /health untuk cek status.",
  });
});

app.get("/health", (req, res) => {
  const state = mongoose.connection.readyState;
  let dbStatus = "disconnected";
  if (state === 1) dbStatus = "connected";
  else if (state === 2) dbStatus = "connecting";
  else if (state === 3) dbStatus = "disconnecting";

  res.json({ status: "ok", server: "running", database: dbStatus });
});

app.use((err, req, res, next) => {
  console.error("🚨 Global Error Handler:", err.stack);
  const statusCode = err.status || 500;
  const message =
    statusCode === 500 ? "Terjadi kesalahan pada server." : err.message;
  res.status(err.status || 500).json({
    status: "error",
    message: "Terjadi kesalahan pada sistem internal kami.",
  });
});

connectDB();

const transporter = require("./config/mailer");

mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB Connected");

  cron.schedule("*/10 * * * * *", () => {
    queueController.runGlobalScheduler();
  });
  console.log("⏰ Auto-Skip Scheduler Activated (Running every 10 seconds)");

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server backend berjalan di http://localhost:${PORT}`);
    console.log(`🌐 Akses Eksternal/Emulator di ${HOST}:${PORT}`);

    transporter
      .verify()
      .then(() => {
        console.log("✅ SMTP Brevo READY");
      })
      .catch((err) => {
        console.error("❌ SMTP Brevo FAILED:", err);
      });
  });
});
