const mongoose = require("mongoose");
const School = require("../models/School");
const SchoolMember = require("../models/SchoolMember");
const User = require("../models/User"); // ✅ Dideklarasikan 1x saja di sini
const QueueEntry = require("../models/QueueEntry");
const Event = require("../models/Events");

const getUserFromToken = async (req) => {
  if (req._id) return req;

  // Jika req adalah objek request Express
  if (req.user) return req.user;

  throw new Error("Pengguna tidak terautentikasi");
};
// ==========================================
// 1. LEAVE SCHOOL (KELUAR MANDIRI)
// ==========================================
exports.leaveSchool = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req);

    if (!currentUser.sekolah) {
      return res
        .status(400)
        .json({ message: "Anda tidak terhubung ke sekolah manapun." });
    }

    const schoolId = currentUser.sekolah._id || currentUser.sekolah;

    // A. CEK KEAMANAN (Admin Terakhir Dilarang Keluar)
    if (currentUser.peran === "ADMIN") {
      const adminCount = await User.countDocuments({
        sekolah: schoolId,
        peran: "ADMIN",
      });

      if (adminCount <= 1) {
        return res.status(400).json({
          message:
            "Anda adalah satu-satunya Admin. Harap angkat admin lain sebelum keluar.",
        });
      }
    }

    // B. Update Status di History (SchoolMember)
    await SchoolMember.updateMany(
      { user: currentUser._id, school: schoolId, status: "approved" },
      {
        $set: {
          status: "left",
          role: "student",
          adminRequestStatus: "NONE",
        },
      }
    );

    // C. 🔥 RESET USER (Hapus Sekolah, Peran, dan NIS)
    await User.updateOne(
      { _id: currentUser._id },
      {
        $set: {
          idSekolah: null,
          sekolah: null,
          peran: "PENGGUNA",
          nis: null, // 🔥 RESET NIS JADI NULL
        },
      }
    );

    res.json({
      message: "Berhasil keluar dari sekolah. Akun Anda telah di-reset.",
    });
  } catch (error) {
    console.error("🚨 Leave School Error:", error);
    res.status(500).json({ message: "Gagal keluar dari sekolah" });
  }
};

// ==========================================
// 2. LIST MEMBERS
// ==========================================
exports.listMembers = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req);
    const schoolId = currentUser.sekolah._id || currentUser.sekolah;
    const { status } = req.query;

    const filter = { school: schoolId };
    if (status) filter.status = status.toLowerCase();

    // Ambil data anggota
    const members = await SchoolMember.find(filter)
      .populate(
        "user",
        "namaPengguna fotoProfil kelas jurusan peran createdAt noHp diwakiliOrangTua tempatLahir tanggalLahir alamat nis namaOrangTua kategoriSekolah"
      )
      .sort({ updatedAt: -1 });

    // 🔥 PERBAIKAN: Filter data agar User valid DAN bukan SUPER_ADMIN
    const validMembers = members.filter((m) => {
      return m.user != null && m.user.peran !== "SUPER_ADMIN";
    });

    const dataWithStats = await Promise.all(
      validMembers.map(async (m) => {
        const totalAntreanSelesai = await QueueEntry.countDocuments({
          pengguna: m.user._id,
          statusAntrian: "SELESAI",
        });

        return {
          membershipId: m._id,
          status: m.status,
          totalAntrean: totalAntreanSelesai,
          adminRequestStatus: m.adminRequestStatus || "NONE",
          nip: m.nip || null,
          ...m.user._doc, // Mengambil data user
        };
      })
    );

    res.json({ data: dataWithStats });
  } catch (error) {
    console.error("List Member Error:", error);
    res.status(500).json({ message: "Gagal memuat daftar anggota" });
  }
};

// ==========================================
// 3. CREATE SCHOOL
// ==========================================
exports.createSchool = async (req, res) => {
  try {
    const { namaSekolah, kategoriSekolah, kodeAksesStatis, idSekolah } =
      req.body;
    if (!namaSekolah || !kategoriSekolah || !kodeAksesStatis || !idSekolah) {
      return res
        .status(400)
        .json({ message: "Data sekolah wajib diisi lengkap" });
    }
    const sekolahBaru = await School.create(req.body);
    res.status(201).json(sekolahBaru);
  } catch (error) {
    console.error("🚨 Create School Error:", error);
    res
      .status(error.code === 11000 ? 400 : 500)
      .json({ message: "Gagal mendaftarkan sekolah" });
  }
};

// ==========================================
// 4. LIST SCHOOLS
// ==========================================
exports.listSchools = async (req, res) => {
  try {
    let { kategoriSekolah, search, page = 1, limit = 10 } = req.query;
    if (!kategoriSekolah) {
      try {
        const currentUser = await getUserFromToken(req.user);
        kategoriSekolah = currentUser.kategoriSekolah;
      } catch (err) {
        // Abaikan jika filter silang gagal
      }
    }

    const filter = {};
    if (kategoriSekolah) filter.kategoriSekolah = kategoriSekolah;
    if (search) filter.namaSekolah = { $regex: search, $options: "i" };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      School.find(filter)
        .select("-kodeAksesStatis")
        .sort({ namaSekolah: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      School.countDocuments(filter),
    ]);

    res.json({
      data: items,
      meta: { page: parseInt(page), total, hasNextPage: page * limit < total },
    });
  } catch (error) {
    console.error("🚨 List School Error:", error);
    res.status(500).json({ message: "Gagal memuat daftar sekolah" });
  }
};

// ==========================================
// 5. JOIN SCHOOL (REQUEST)
// ==========================================
exports.joinSchool = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req);
    const { schoolId } = req.params;

    // 1. CARI SEKOLAH TARGET
    const school = mongoose.Types.ObjectId.isValid(schoolId)
      ? await School.findById(schoolId)
      : await School.findOne({ idSekolah: schoolId });

    if (!school)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });

    // 2. BERSIHKAN STATUS AKTIF DI SEKOLAH LAIN (Supaya tidak double active)
    await SchoolMember.deleteMany({
      user: currentUser._id,
      status: { $in: ["pending", "approved"] },
      school: { $ne: school._id }, // Jangan hapus history sekolah INI
    });

    // 3. CEK APAKAH PERNAH GABUNG DI SINI? (Cek history 'left', 'rejected', dll)
    const existingMember = await SchoolMember.findOne({
      school: school._id,
      user: currentUser._id,
    });

    if (existingMember) {
      // 🔥 KASUS 1: DATA LAMA DITEMUKAN (RE-JOIN)
      // Kita update baris lama, jangan bikin baru biar gak error Duplicate Key

      // Cek dulu kalau ternyata iseng join padahal udah aktif
      if (existingMember.status === "approved") {
        return res
          .status(409)
          .json({ message: "Anda sudah menjadi anggota sekolah ini." });
      }
      if (existingMember.status === "pending") {
        return res
          .status(409)
          .json({ message: "Pengajuan Anda sedang diproses." });
      }

      // Update data lama jadi pending lagi
      existingMember.status = "pending";
      existingMember.role = currentUser.diwakiliOrangTua ? "parent" : "student";
      existingMember.adminRequestStatus = "NONE";
      await existingMember.save(); // Simpan perubahan
    } else {
      // 🔥 KASUS 2: BELUM PERNAH GABUNG SAMA SEKALI
      // Baru boleh pakai Create
      await SchoolMember.create({
        school: school._id,
        user: currentUser._id,
        status: "pending",
        role: currentUser.diwakiliOrangTua ? "parent" : "student",
        adminRequestStatus: "NONE",
      });
    }

    // 4. RESET FIELD DI USER
    await User.updateOne(
      { _id: currentUser._id },
      { $set: { adminRequestStatus: "NONE", sekolah: null, idSekolah: null } }
    );

    res.status(201).json({ message: "Pengajuan bergabung berhasil dikirim" });
  } catch (error) {
    console.error("🚨 Join Error:", error);
    // Tangani error duplicate key sebagai fallback terakhir
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Terjadi kesalahan data duplikat. Coba refresh." });
    }
    res.status(500).json({ message: "Gagal mengajukan bergabung" });
  }
};

// ==========================================
// 6. UPDATE SCHOOL
// ==========================================
exports.updateSchool = async (req, res) => {
  try {
    const { schoolId } = req.params;

    const schoolDoc = mongoose.Types.ObjectId.isValid(schoolId)
      ? await School.findById(schoolId)
      : await School.findOne({ idSekolah: schoolId });

    if (!schoolDoc)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });

    Object.assign(schoolDoc, req.body);
    await schoolDoc.save();

    res.json({ message: "Data diperbarui", school: schoolDoc });
  } catch (error) {
    console.error("🚨 Update Error:", error);
    res.status(500).json({ message: "Gagal update sekolah" });
  }
};

// ==========================================
// 7. CANCEL JOIN REQUEST
// ==========================================
exports.cancelJoinRequest = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req.user);
    const { schoolId } = req.params;

    let schoolFilter = mongoose.Types.ObjectId.isValid(schoolId)
      ? { _id: schoolId }
      : { idSekolah: schoolId };

    const school = await School.findOne(schoolFilter);
    if (!school)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });

    const approvedMember = await SchoolMember.findOne({
      school: school._id,
      user: currentUser._id,
      status: "approved",
    });

    if (approvedMember) {
      return res.status(409).json({ message: "sudah diterima" });
    }

    const membership = await SchoolMember.findOne({
      school: school._id,
      user: currentUser._id,
      status: "pending",
    });

    if (!membership) {
      return res.status(400).json({ message: "Tidak ada pengajuan aktif." });
    }

    await SchoolMember.deleteOne({ _id: membership._id });
    res.json({ message: "Pengajuan berhasil dibatalkan" });
  } catch (error) {
    console.error("Cancel Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
};

// ==========================================
// 8. GET MY SCHOOL STATUS
// ==========================================
exports.getMySchoolStatus = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req);

    // 1. Bypass untuk Super Admin
    if (currentUser.peran === "SUPER_ADMIN" || currentUser.peran === "PENELITI") {
      return res.json({
        status: "approved",
        currentSchool: { namaSekolah: "Sistem Antrikuy", idSekolah: "SUPER-ADMIN", _id: "global" },
        pendingSchool: null,
        userKategoriSekolah: "GLOBAL",
      });
    }

    // 2. Cari semua record keanggotaan user
    const memberships = await SchoolMember.find({ user: currentUser._id })
      .populate("school")
      .sort({ updatedAt: -1 });

    // Cek status secara aman
    const active = memberships.find((m) => m.status === "approved" && m.school);
    const pending = memberships.find((m) => m.status === "pending" && m.school);

    // 3. Logic Sinkronisasi (Hanya jalan jika ada sekolah yang benar-benar aktif)
    if (active && active.school) {
        // Karena kita sudah pastikan active.school tidak null, aman akses ._id
        const schoolIdStr = active.school._id.toString();
        const userSchoolStr = currentUser.sekolah ? currentUser.sekolah.toString() : null;

        if (userSchoolStr !== schoolIdStr) {
            await User.updateOne(
                { _id: currentUser._id },
                { $set: { sekolah: active.school._id, idSekolah: active.school.idSekolah } }
            );
        }
    }

    // 4. Cek pembubaran (Hanya jika user punya sekolah aktif di profilnya)
    let isDissolving = false;
    if (currentUser.sekolah) {
       try {
         const DissolveRequest = require("../models/DissolveRequest");
         const dr = await DissolveRequest.findOne({ 
           school: currentUser.sekolah, 
           status: "PENDING" 
         });
         isDissolving = !!dr;
       } catch (e) { /* ignore */ }
    }

    // 5. Kembalikan Respon (Aman dari null pointer)
    res.json({
      status: active ? "approved" : (pending ? "pending" : "none"),
      currentSchool: active ? active.school : null,
      pendingSchool: pending ? pending.school : null,
      isDissolving: isDissolving,
      userKategoriSekolah: currentUser.kategoriSekolah || null,
    });

  } catch (error) {
    console.error("🚨 My School Status Error:", error);
    res.status(500).json({ message: "Gagal memproses status sekolah" });
  }
};

// ==========================================
// 9. UPDATE MEMBER STATUS (KICK / DEMOTE / APPROVE JOIN)
// ==========================================
exports.updateMemberStatus = async (req, res) => {
  try {
    const { membershipId } = req.params;
    const { action } = req.body;

    const membership = await SchoolMember.findById(membershipId).populate(
      "school user"
    );
    if (!membership)
      return res.status(404).json({ message: "Data anggota tidak ditemukan" });

    // --- APPROVE (Terima Siswa Masuk) ---
    if (action === "APPROVE") {
      membership.status = "approved";
      membership.role = "student";
      await membership.save();

      // (User sudah di-import di atas, jangan declare lagi)
      await User.findByIdAndUpdate(membership.user._id, {
        sekolah: membership.school._id,
        idSekolah: membership.school.idSekolah,
      });
    }

    // --- DEMOTE (Turunkan Pangkat Admin -> Siswa) ---
    else if (action === "DEMOTE") {
      const adminCount = await User.countDocuments({
        sekolah: membership.school._id,
        peran: "ADMIN",
      });

      if (adminCount <= 1) {
        return res
          .status(400)
          .json({ message: "Tidak dapat menurunkan admin terakhir." });
      }

      membership.role = "student";
      membership.adminRequestStatus = "NONE";
      await membership.save();

      // Demote hanya turunkan pangkat, sekolah tetap
      await User.findByIdAndUpdate(membership.user._id, { peran: "PENGGUNA" });

      return res.json({
        message: "Berhasil menurunkan pangkat menjadi Siswa.",
      });
    }

    // --- KICK / REJECT (Keluarkan Anggota) ---
    else if (action === "REJECT" || action === "KICK") {
      // A. Cek Admin Terakhir
      if (membership.user.peran === "ADMIN" || membership.role === "admin") {
        const adminCount = await User.countDocuments({
          sekolah: membership.school._id,
          peran: "ADMIN",
        });

        if (adminCount <= 1 && action === "KICK") {
          return res.status(400).json({
            message: "DILARANG: Tidak dapat mengeluarkan admin terakhir.",
          });
        }
      }

      // B. Update History
      membership.status = action === "REJECT" ? "rejected" : "left";
      membership.role = "student";
      membership.adminRequestStatus = "NONE";
      await membership.save();

      // C. 🔥 RESET USER (Hapus Sekolah, Pangkat, dan NIS)
      await User.findByIdAndUpdate(membership.user._id, {
        $set: {
          sekolah: null,
          idSekolah: null,
          peran: "PENGGUNA",
          nis: null, // 🔥 RESET NIS JADI NULL
        },
      });
    }

    res.json({ message: `Berhasil memproses ${action}` });
  } catch (error) {
    console.error("🚨 Update Member Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// 10. APPROVE ADMIN REQUEST (NAIK PANGKAT)
// ==========================================
exports.approveAdminRequest = async (req, res) => {
  try {
    const { memberId, action } = req.body;

    if (!memberId || !["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ message: "Data tidak valid." });
    }

    const member = await SchoolMember.findById(memberId);
    if (!member) {
      return res.status(404).json({ message: "Data anggota tidak ditemukan." });
    }

    // --- REJECT ---
    if (action === "REJECT") {
      member.adminRequestStatus = "REJECTED";
      await member.save();
      return res.status(200).json({ message: "Pengajuan Admin ditolak." });
    }

    // --- APPROVE ---
    if (action === "APPROVE") {
      // A. Update Member
      member.role = "teacher";
      member.adminRequestStatus = "APPROVED";
      await member.save();

      // B. 🔥 UPDATE USER (Role & NIS)
      const updateData = { peran: "ADMIN" };

      // Timpa NIS dengan NIP jika NIP valid (>= 16 digit)
      if (member.nip && member.nip.length >= 16) {
        updateData.nis = member.nip;
      }

      // (Jangan declare 'User' lagi!)
      await User.findByIdAndUpdate(member.user, { $set: updateData });

      // C. Bersihkan Antrean
      const activeQueues = await QueueEntry.find({
        pengguna: member.user,
        statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA"] },
      });

      if (activeQueues.length > 0) {
        await QueueEntry.updateMany(
          {
            pengguna: member.user,
            statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA"] },
          },
          {
            $set: {
              statusAntrian: "DIBATALKAN",
              alasanBatal: "User diangkat menjadi Guru/Admin",
              waktuSelesai: new Date(),
            },
          }
        );

        const updatePromises = activeQueues.map((q) =>
          Event.findByIdAndUpdate(q.event, { $inc: { slotsTaken: -1 } })
        );
        await Promise.all(updatePromises);
      }

      return res.status(200).json({
        success: true,
        message: "Pengajuan disetujui. Role diperbarui & NIS disesuaikan.",
      });
    }
  } catch (error) {
    console.error("🚨 Error approveAdminRequest:", error);
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
};

// ==========================================
// 11. REQUEST NEW SCHOOL (DAFTAR SEKOLAH BARU)
// ==========================================
exports.requestNewSchool = async (req, res) => {
  try {
    const { namaSekolah, npsn, kategoriSekolah, alamat, deskripsi, lat, lng } =
      req.body;
    const userObjectId = req.user._id; // ID MongoDB Pengaju

    // Generate ID & Kode (seperti sebelumnya)
    const generatedId = `${namaSekolah
      .toUpperCase()
      .replace(/\s+/g, "-")}-${Math.floor(1000 + Math.random() * 9000)}`;
    const generatedKode = `${namaSekolah
      .substring(0, 3)
      .toUpperCase()}${Math.floor(100 + Math.random() * 900)}`;

    const newSchool = new School({
      namaSekolah,
      npsn,
      kategoriSekolah,
      alamat,
      deskripsi,
      idSekolah: generatedId,
      kodeAksesStatis: generatedKode,
      penyediaAntrian: false,
      lokasiMaps: { lat, lng },
      createdBy: userObjectId, // 🔥 WAJIB ADA! Ini yang tadi hilang di DB Anda
      status: "PENDING",
    });

    const savedSchool = await newSchool.save();

    // Buat keanggotaan pending
    await SchoolMember.create({
      school: savedSchool._id,
      user: userObjectId,
      status: "pending",
      role: "admin",
    });

    // Update User agar terhubung ke ID sekolah (tapi peran tetap pengguna)
    await User.findByIdAndUpdate(userObjectId, {
      idSekolah: savedSchool.idSekolah,
      sekolah: savedSchool._id, // Hubungkan ObjectID juga
    });

    res.status(201).json({ success: true, message: "Pengajuan dikirim!" });
  } catch (error) {
    res.status(500).json({ message: "Gagal memproses: " + error.message });
  }
};

// ==========================================
// 12. GET ADMIN STATS (DASHBOARD)
// ==========================================
exports.getAdminStats = async (req, res) => {
  try {
    // 1. Validasi sekolah admin
    const schoolId = req.user.sekolah;
    if (!schoolId) {
      return res.status(400).json({
        status: "error",
        message: "Admin tidak memiliki akses ke sekolah mana pun",
      });
    }

    // 2. Ambil semua event milik sekolah
    const events = await Event.find({ sekolah: schoolId }).select("_id");
    if (!events.length) {
      return res.status(200).json({
        status: "success",
        data: {
          stats: { waiting: 0, serving: 0, completed: 0, total: 0 },
          servingNow: null,
          nextInLine: null,
          waitingList: [],
        },
      });
    }

    const eventIds = events.map((e) => e._id);

    // 3. Ambil semua antrian dari event sekolah
    const queues = await QueueEntry.find({ event: { $in: eventIds } })
      .populate("pengguna", "namaPengguna fotoProfil")
      .populate("event", "namaKegiatan")
      .sort({ nomorAntrian: 1 });

    // 4. Inisialisasi response
    const stats = {
      waiting: 0,
      serving: 0,
      completed: 0,
      total: queues.length,
    };

    let servingNow = null;
    let nextInLine = null;
    const waitingList = [];

    // 5. Helper formatter (AMAN)
    const formatQueue = (q) => ({
      _id: q._id,
      nomorAntrian: q.nomorAntrian,
      statusAntrian: q.statusAntrian,
      user: q.pengguna
        ? {
            nama: q.pengguna.namaPengguna,
            foto: q.pengguna.fotoProfil,
          }
        : null,
      event: q.event
        ? {
            namaKegiatan: q.event.namaKegiatan,
          }
        : null,
    });

    // 6. Hitung statistik & susun data
    for (const q of queues) {
      const formatted = formatQueue(q);

      if (["MENUNGGU", "REQ_TUNDA"].includes(q.statusAntrian)) {
        stats.waiting++;
        waitingList.push(formatted);
        if (!nextInLine) nextInLine = formatted;
      } else if (["DIPANGGIL", "DILAYANI"].includes(q.statusAntrian)) {
        stats.serving++;
        servingNow = formatted;
      } else if (q.statusAntrian === "SELESAI") {
        stats.completed++;
      }
    }

    // 7. Kirim response
    res.status(200).json({
      status: "success",
      data: {
        stats,
        servingNow,
        nextInLine,
        waitingList,
      },
    });
  } catch (error) {
    console.error("🚨 getAdminStats ERROR:", error);
    res.status(500).json({
      status: "error",
      message: "Gagal mengambil data dashboard admin",
    });
  }
};


// Helper function
function formatObj(q) {
  return {
    _id: q._id,
    nomorAntrian: q.nomorAntrian,
    statusAntrian: q.statusAntrian,
    user: {
      name: q.pengguna?.namaPengguna || "User",
      foto: q.pengguna?.fotoProfil,
    },
    event: { namaKegiatan: q.event?.namaKegiatan || "-" },
  };
}

function formatObj(q) {
  return {
    _id: q._id,
    nomorAntrian: q.nomorAntrian,
    statusAntrian: q.statusAntrian,
    user: { name: q.user?.name || "User", foto: q.user?.fotoProfil },
    event: { namaKegiatan: q.event?.namaKegiatan || "-" },
  };
}
