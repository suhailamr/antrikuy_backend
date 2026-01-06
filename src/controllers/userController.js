const authService = require("../services/authService");
const User = require("../models/User");
const SchoolMember = require("../models/SchoolMember");
const admin = require("../firebase/firebaseAdmin");

const {
  updateCurrentUserBiodata,
  findOrCreateUserFromFirebase,
} = require("../services/authService");

const resolveMongoUser = async (req) => {
  if (req.user && req.user._id) {
    return await User.findById(req.user._id);
  }

  if (req.user && req.user.uid) {
    return await User.findOne({ firebaseUid: req.user.uid });
  }

  if (req.user && req.user.email) {
    return await User.findOne({ email: req.user.email });
  }

  return null;
};

const filterUserResponse = (user) => {
  if (!user) return null;
  const userObj = user.toObject ? user.toObject() : user;
  const { passwordHash, otpCode, otpExpiry, ...safeUser } = userObj;
  return safeUser;
};

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

exports.getMe = async (req, res) => {
  try {
    const userReq = getUserFromRequest(req, res);
    if (!userReq) return;

    const user = await User.findById(userReq._id).populate("sekolah");

    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const member = await SchoolMember.findOne({
      user: user._id,
      status: { $regex: /^approved$/i },
    });

    const userData = filterUserResponse(user);

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

    const user = await updateCurrentUserBiodata(userReq, req.body);

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

    if (!nip) {
      return res.status(400).json({ message: "NUPTK/NIP wajib diisi." });
    }

    console.log(
      `[DEBUG ADMIN-REQ] Memulai Request Admin dari User: ${userReq.namaPengguna}`
    );

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

    member.nip = nip;
    member.adminRequestStatus = "PENDING";
    member.adminRequestDate = new Date();

    await member.save();

    console.log(`[DEBUG] Status saved di DB. Mencoba kirim notifikasi...`);

    const userFresh = await resolveMongoUser(req);

    console.log("[DEBUG ADMIN-REQ] Mongo user:", {
      id: userFresh?._id,
      hasToken: !!userFresh?.fcmToken,
    });

    if (userFresh && userFresh.fcmToken) {
      console.log(
        `[DEBUG FCM] Token ditemukan: ${userFresh.fcmToken.substring(0, 10)}...`
      );

      const message = {
        data: {
          title: "Pengajuan Terkirim! 📝",
          body: `Permintaan akses Admin di ${member.school?.namaSekolah} sedang diproses.`,
          type: "ADMIN_REQUEST",
          status: "PENDING",
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

exports.updateFcmToken = async (req, res) => {
  try {
    console.log("[DEBUG FCM] Raw req.user:", req.user);

    const mongoUser = await resolveMongoUser(req);

    if (!mongoUser) {
      console.error("[DEBUG FCM] ❌ Mongo user TIDAK ditemukan");
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    console.log("[DEBUG FCM] Mongo user ditemukan:", {
      _id: mongoUser._id,
      firebaseUid: mongoUser.firebaseUid,
    });

    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: "FCM token wajib dikirim" });
    }

    mongoUser.fcmToken = fcmToken;
    await mongoUser.save();

    console.log("[DEBUG FCM] ✅ Token tersimpan ke Mongo user");

    res.json({ success: true });
  } catch (err) {
    console.error("[DEBUG FCM] ERROR:", err);
    res.status(500).json({ message: "Gagal update FCM" });
  }
};
