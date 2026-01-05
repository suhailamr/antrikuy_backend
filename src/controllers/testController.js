// src/controllers/testController.js

// Pastikan path ini mengarah ke file service yang kamu edit di langkah 1
// Jika filenya bernama authService.js, ganti jadi require("../services/authService")
const userService = require("../services/authService"); 

exports.getTestToken = async (req, res) => {
  try {
    // Security check: Hanya jalan di mode development
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Akses ditolak di production" });
    }

    const { target } = req.body;
    if (!target) {
        return res.status(400).json({ success: false, message: "Target (email/hp) wajib diisi" });
    }

    const result = await userService.generateTestToken(target);

    // Tampilkan di terminal backend juga (opsional)
    console.log("=========================================");
    console.log(`[TEST TOKEN] User: ${target}`);
    console.log(`[TOKEN] ${result.customToken}`);
    console.log("=========================================");

    res.json({
      success: true,
      token: result.customToken,
      user: result.user,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};