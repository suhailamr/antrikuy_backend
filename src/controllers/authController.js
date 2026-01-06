const authService = require("../services/authService");
const User = require("../models/User");
const Event = require("../models/Events");
const admin = require("../firebase/firebaseAdmin");

const filterUserResponse = (user) => {
  if (!user) return null;
  const userObj = user.toObject ? user.toObject() : user;
  const { passwordHash, otpCode, otpExpiry, ...safeUser } = userObj;
  return safeUser;
};

exports.checkUser = async (req, res) => {
  try {
    const { input, password } = req.body;
    const user = await authService.validateUserPassword(input, password);
    res.json({
      status: "success",
      message: "Password valid",
      user: {
        email: user.email,
        noHp: user.noHp,
        firebaseUid: user.firebaseUid,
      },
    });
  } catch (error) {
    res.status(401).json({ message: "User atau Password Salah." });
  }
};

exports.exchangeToken = async (req, res) => {
  try {
    const result = await authService.exchangeCustomToken(req.body);
    res.json({
      status: "success",
      customToken: result.customToken,
      user: filterUserResponse(result.user),
    });
  } catch (error) {
    console.error("🚨 Exchange Token Error:", error.message);
    res.status(400).json({ message: "OTP Salah atau Kadaluwars" });
  }
};

exports.getMe = (req, res) => {
  res.json({
    message: "Token valid",
    uid: req.user.firebaseUid,
    email: req.user.email,
    name: req.user.name || req.user.namaPengguna || null,
  });
};

exports.registerPengguna = async (req, res) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      throw new Error(
        "Token tidak ditemukan. Pastikan header Authorization dikirim."
      );
    }

    const decodedToken = await admin.auth().verifyIdToken(token);

    const { idSekolah, password, ...biodata } = req.body;

    const user = await authService.findOrCreateUserFromFirebase(decodedToken, {
      peran: "PENGGUNA",
      idSekolah,
      password,
      biodata,
    });

    res.status(201).json({
      message: "Registrasi berhasil",
      user: filterUserResponse(user),
    });
  } catch (error) {
    console.error("🚨 Register Error:", error);

    res.status(500).json({
      message: error.message || "Gagal registrasi",
    });
  }
};

exports.registerAdmin = async (req, res) => {
  try {
    const user = await authService.findOrCreateUserFromFirebase(req.user, {
      peran: "ADMIN",
      idSekolah: req.body.idSekolah,
    });
    res.status(201).json({
      message: "Registrasi admin berhasil",
      user: filterUserResponse(user),
    });
  } catch (error) {
    res.status(400).json({ message: "Gagal registrasi admin" });
  }
};

exports.sendOtpEmail = async (req, res) => {
  try {
    await authService.sendEmailOtp(req.body.email);
    res.status(200).json({ message: "Kode OTP dikirim." });
  } catch (e) {
    console.error("🔥 EMAIL OTP ERROR:", e);
    res.status(500).json({
      message: "Email tidak terdaftar. Silahkan coba lagi!",
    });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    await authService.verifyOtpCode(req.body.target, req.body.otpCode);
    res.status(200).json({ message: "Verifikasi OTP sukses." });
  } catch (e) {
    res.status(400).json({ message: "Kode OTP salah atau kedaluwarsa" });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Password lama dan baru wajib diisi" });
    }

    await authService.syncUserPasswordToMongo(
      req.user.firebaseUid,
      currentPassword,
      newPassword
    );
    res.json({ status: "success", message: "Password berhasil diperbarui" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    await authService.resetPasswordWithOtp(
      req.body.target,
      req.body.otpCode,
      req.body.password
    );
    res.json({ message: "Password berhasil diubah." });
  } catch (error) {
    res.status(400).json({ message: "Gagal mereset password" });
  }
};

exports.requestEmailChange = async (req, res) => {
  try {
    await authService.sendOtpForEmailChange(
      req.user.firebaseUid,
      req.body.newEmail
    );
    res.json({ message: "OTP dikirim ke email baru." });
  } catch (error) {
    res.status(400).json({ message: "Gagal memproses permintaan" });
  }
};

exports.verifyEmailChange = async (req, res) => {
  try {
    await authService.verifyAndChangeEmail(
      req.user.firebaseUid,
      req.body.newEmail,
      req.body.otp
    );
    res.json({ message: "Email berhasil diperbarui!" });
  } catch (error) {
    res.status(400).json({ message: "Gagal memverifikasi email" });
  }
};

exports.requestPhoneChange = async (req, res) => {
  try {
    await authService.sendOtpForPhoneChange(
      req.user.firebaseUid,
      req.body.newPhone
    );
    res.json({ message: "OTP dikirim (Cek Console Server)." });
  } catch (error) {
    res.status(400).json({ message: "Gagal memproses permintaan" });
  }
};

exports.verifyPhoneChange = async (req, res) => {
  try {
    await authService.verifyAndChangePhone(
      req.user.firebaseUid,
      req.body.newPhone,
      req.body.otp
    );
    res.json({ message: "Nomor HP berhasil diperbarui!" });
  } catch (error) {
    res.status(400).json({ message: "Gagal memverifikasi nomor HP" });
  }
};

exports.toggleEventLock = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event)
      return res.status(404).json({ message: "Layanan tidak ditemukan" });

    event.isLocked = req.body.isLocked;
    await event.save();

    res.json({
      message: `Layanan ${event.isLocked ? "DIKUNCI" : "DIBUKA"}.`,
      data: event,
    });
  } catch (err) {
    console.error("🚨 System Error [toggleEventLock]:", err);
    res.status(500).json({ message: "Gagal mengubah status kunci layanan." });
  }
};
