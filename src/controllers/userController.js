const authService = require("../services/authService");
const User = require("../models/User");
const SchoolMember = require("../models/SchoolMember");
const {
  updateCurrentUserBiodata,
  findOrCreateUserFromFirebase,
} = require("../services/authService");

const filterUserResponse = (user) => {
  if (!user) return null;
  const userObj = user.toObject ? user.toObject() : user;
  const { passwordHash, otpCode, otpExpiry, ...safeUser } = userObj;
  return safeUser;
};

// Helper untuk memastikan user object valid dari middleware
const getUserFromRequest = (req, res) => {
  const user = req.user;
  if (!user || !user._id) {
    console.error("[ERROR] User object invalid di controller.");
    if (res)
      return res
        .status(401)
        .json({ message: "Sesi tidak valid. Silakan login ulang." });
    return null;
  }
  return user;
};

// 🔥 UPDATE: getMe yang sudah diperbaiki
exports.getMe = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    // Ambil data user terbaru dari DB untuk memastikan populate berjalan
    const user = await User.findById(userReq._id).populate("sekolah");

    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // 2. 🔥 Cari Data Member
    const member = await SchoolMember.findOne({
      user: user._id,
      status: { $regex: /^approved$/i }, // Regex agar case-insensitive
    });

    // 3. Siapkan respon data user
    const userData = filterUserResponse(user);

    // 4. 🔥 Inject field
    userData.adminRequestStatus = member ? member.adminRequestStatus : "NONE";
    if (member) {
      userData.schoolRole = member.role;
    }

    res.json({
      status: "success",
      user: userData,
    });
  } catch (err) {
    console.error("🚨 Get Profile Error:", err);
    res.status(500).json({ message: "Gagal memuat profil pengguna" });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    const { nis } = req.body;

    // Validasi NIS
    if (nis) {
      if (!/^\d+$/.test(nis)) {
        return res
          .status(400)
          .json({ message: "Format NIS/NUPTK salah: Hanya boleh angka." });
      }
      if (nis.length < 10 || nis.length > 16) {
        return res
          .status(400)
          .json({ message: "Format NIS/NUPTK salah: Harus 10-16 digit." });
      }
    }

    // Update Biodata Service
    const user = await updateCurrentUserBiodata(userReq, req.body);

    // Fetch ulang status admin request biar data fresh
    const member = await SchoolMember.findOne({
      user: user._id,
      status: { $regex: /^approved$/i },
    });

    const responseUser = filterUserResponse(user);
    responseUser.adminRequestStatus = member
      ? member.adminRequestStatus
      : "NONE";

    res.json({
      message: "Biodata pengguna berhasil diperbarui",
      user: responseUser,
    });
  } catch (error) {
    console.error("🚨 Update Biodata Error:", error.message);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((val) => val.message);
      return res.status(400).json({ message: messages[0] });
    }

    res.status(400).json({ message: "Gagal memperbarui biodata" });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Password lama dan baru wajib diisi" });
    }

    await authService.syncUserPasswordToMongo(
      userReq.firebaseUid,
      currentPassword,
      newPassword
    );

    res.json({ status: "success", message: "Password berhasil diperbarui" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.registerPengguna = async (req, res) => {
  try {
    const { password, ...biodata } = req.body;

    const user = await findOrCreateUserFromFirebase(req.user, {
      password,
      biodata,
    });

    res.status(201).json({
      status: "success",
      user: filterUserResponse(user),
    });
  } catch (error) {
    console.error("🚨 Register User Error:", error.message);
    res.status(400).json({ message: "Gagal melakukan registrasi pengguna" });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    const { email, noHp } = req.body;

    if (!email && !noHp) {
      return res.status(400).json({ message: "Data kontak kosong" });
    }

    await User.updateOne(
      { _id: userReq._id },
      {
        $set: {
          ...(email && { email }),
          ...(noHp && { noHp }),
        },
      }
    );

    res.json({ message: "Kontak berhasil diperbarui" });
  } catch (err) {
    console.error("🚨 Update Contact Error:", err);
    res.status(500).json({ message: "Gagal memperbarui kontak" });
  }
};

exports.requestAdminAccess = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    const { nip } = req.body;

    // 1. Validasi Input
    if (!nip) {
      return res.status(400).json({ message: "NUPTK/NIP wajib diisi." });
    }

    console.log(
      `[DEBUG ADMIN-REQ] Memulai Request Admin dari User: ${userReq.namaPengguna}`
    );

    // 2. Cari Member Sekolah
    const member = await SchoolMember.findOne({
      user: userReq._id,
      status: { $regex: /^approved$/i },
    }).populate("school", "namaSekolah");

    if (!member) {
      return res.status(400).json({
        message:
          "Anda belum bergabung ke sekolah manapun (atau status keanggotaan belum disetujui).",
      });
    }

    // 3. Cek Role Existing
    const existingRoles = [
      "admin",
      "teacher",
      "superadmin",
      "ADMIN",
      "TEACHER",
    ];
    if (existingRoles.includes(member.role)) {
      return res.status(400).json({
        message: "Anda sudah memiliki akses Admin/Guru di sekolah ini.",
      });
    }

    if (member.adminRequestStatus === "PENDING") {
      return res.status(400).json({
        message:
          "Pengajuan Anda sedang diproses. Harap tunggu konfirmasi dari Operator Sekolah.",
      });
    }

    // 4. Update Data Member ke Database
    member.nip = nip;
    member.adminRequestStatus = "PENDING";
    member.adminRequestDate = new Date();

    await member.save();

    console.log(`[DEBUG] Status saved di DB. Mencoba kirim notifikasi...`);

    // ==========================================
    // 🔥 BAGIAN KIRIM NOTIFIKASI (BARU)
    // ==========================================

    // Ambil data user terbaru untuk dapat token
    const userFresh = await User.findOne({
      firebaseUid: req.user.uid, // 🔥 KUNCI SAMA
    });

    const userFresh = await User.findOne({
      firebaseUid: req.user.uid, // 🔥 KUNCI SAMA
    });

    if (userFresh && userFresh.fcmToken) {
      console.log(
        `[DEBUG FCM] Token ditemukan: ${userFresh.fcmToken.substring(0, 10)}...`
      );

      const message = {
        notification: {
          title: "Pengajuan Terkirim! 📝",
          body: `Permintaan akses Admin di ${member.school?.namaSekolah} sedang diproses.`,
        },
        data: {
          type: "ADMIN_REQUEST", // Untuk navigasi di Flutter nanti
          status: "PENDING",
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        token: userFresh.fcmToken,
      };

      try {
        const response = await admin.messaging().send(message);
        console.log(
          `[SUCCESS] Notifikasi berhasil dikirim ke FCM! ID: ${response}`
        );
      } catch (fcmError) {
        console.error(`[ERROR] Gagal kirim ke Firebase:`, fcmError.message);
        // Kita tidak throw error agar user tetap mendapat response sukses (karena data DB sudah masuk)
      }
    } else {
      console.log(`[WARNING] User tidak punya Token FCM. Notifikasi dilewati.`);
    }

    return res.status(200).json({
      success: true,
      message: `Pengajuan Admin berhasil dikirim.`,
    });
  } catch (error) {
    console.error("🚨 Error requestAdminAccess:", error);
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server saat memproses pengajuan." });
  }
};

exports.updateMedia = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    await User.updateOne({ _id: userReq._id }, { $set: req.body });
    res.json({ message: "Media diperbarui" });
  } catch (error) {
    console.error("🚨 Update Media Error:", error);
    res.status(500).json({ message: "Gagal memperbarui media" });
  }
};

// 🔥 UPDATE: Penambahan Debug Lengkap untuk FCM
exports.updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;

    console.log(
      `[DEBUG FCM] Request masuk untuk update token. UserID: ${req.user?._id}`
    );

    if (!fcmToken) {
      console.warn(
        `[DEBUG FCM] ⚠️ Gagal: Token tidak ditemukan dalam body request.`
      );
      return res.status(400).json({
        message: "FCM token wajib dikirim",
      });
    }

    // Log token (dipotong agar tidak memenuhi terminal)
    const tokenPreview =
      fcmToken.length > 20 ? fcmToken.substring(0, 20) + "..." : fcmToken;
    console.log(`[DEBUG FCM] Token diterima: ${tokenPreview}`);

    // req.user sudah valid karena pakai middleware protect
    const updateResult = await User.updateOne(
      { firebaseUid: req.user.uid },
      { $set: { fcmToken } }
    );

    console.log(`[DEBUG FCM] Hasil MongoDB Update:`, updateResult);

    if (updateResult.nModified === 0) {
      console.log(
        `[DEBUG FCM] ℹ️ Token mungkin sama dengan sebelumnya, tidak ada perubahan data.`
      );
    } else {
      console.log(`[DEBUG FCM] ✅ Token berhasil diperbarui di Database.`);
    }

    res.status(200).json({
      success: true,
      message: "FCM token berhasil disimpan",
    });
  } catch (error) {
    console.error("🚨 Update FCM Error:", error);
    res.status(500).json({
      message: "Gagal menyimpan FCM token",
    });
  }
};
