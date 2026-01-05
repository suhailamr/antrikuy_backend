const admin = require("../firebase/firebaseAdmin");
const User = require("../models/User"); // 🔥 Import Model User

/**
 * Middleware: PROTECT
 * 1. Verifikasi Token Firebase
 * 2. Ambil data User dari MongoDB berdasarkan firebaseUid
 * 3. Simpan data user ke req.user
 */
exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decodedToken = await admin.auth().verifyIdToken(token);

      // Coba cari user
      const user = await User.findOne({ firebaseUid: decodedToken.uid });

      if (!user) {
        // ... kode error user tidak ditemukan ...
        return res
          .status(404)
          .json({ success: false, message: "User tidak ditemukan" });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error("Auth Error:", error.message); // Log error singkat saja
      return res.status(401).json({ message: "Not authorized" });
    }
  } else {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
};

/**
 * Middleware: AUTHORIZE
 * Cek apakah role user yang sedang login diperbolehkan mengakses route ini
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    // req.user sudah diisi oleh middleware 'protect' di atas
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User belum terautentikasi",
      });
    }

    // Cek apakah peran user ada di dalam daftar roles yang diizinkan
    if (!roles.includes(req.user.peran)) {
      return res.status(403).json({
        success: false,
        message: `Role anda (${req.user.peran}) tidak memiliki akses ke sini.`,
      });
    }

    next();
  };
};
