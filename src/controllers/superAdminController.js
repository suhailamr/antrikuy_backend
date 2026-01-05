const School = require("../models/School");
const User = require("../models/User");
const Event = require("../models/Events");
const QueueEntry = require("../models/QueueEntry");
const SchoolMember = require("../models/SchoolMember");
const DissolveRequest = require("../models/DissolveRequest");
const mongoose = require("mongoose");

// 1. Ambil SEMUA sekolah
exports.getAllSchools = async (req, res) => {
  try {
    const schools = await School.find().sort({ namaSekolah: 1 });
    res.status(200).json({ status: "success", data: schools });
  } catch (err) {
    console.error("🚨 Error getAllSchools:", err);
    res.status(500).json({ message: "Gagal mengambil daftar sekolah" });
  }
};

// 2. Ambil pengajuan PENDING (Sekolah Baru)
// Ambil pengajuan PENDING (Pendaftaran Sekolah Baru)
exports.getPendingSchools = async (req, res) => {
  try {
    // Cari sekolah yang penyediaAntrian-nya masih false
    const pendingSchools = await School.find({ penyediaAntrian: false });

    // Kita harus mencari user yang mengajukan sekolah tersebut
    // Gunakan Promise.all agar tidak lambat
    const data = await Promise.all(
      pendingSchools.map(async (school) => {
        const user = await User.findOne({
          idSekolah: school.idSekolah,
          peran: "PENGGUNA",
        });
        if (!user) return null; // Abaikan jika user pengaju tidak ketemu
        return { school, user };
      })
    );

    // Filter null values
    const result = data.filter((item) => item !== null);

    res.status(200).json({ status: "success", data: result });
  } catch (err) {
    console.error("🚨 Error getPendingSchools:", err);
    res
      .status(500)
      .json({ message: "Server gagal memproses daftar pendaftaran" });
  }
};

// 3. Logic Review Sekolah Baru (Setujui/Tolak)
exports.reviewSchoolRequest = async (req, res) => {
  const { schoolId, userId, action } = req.body;
  try {
    const school = await School.findById(schoolId);
    if (!school)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });

    if (action === "APPROVE") {
      school.penyediaAntrian = true;
      await school.save();

      await User.findByIdAndUpdate(userId, {
        peran: "ADMIN_SEKOLAH",
        idSekolah: school.idSekolah,
      });
    } else {
      await School.findByIdAndDelete(schoolId);
    }
    res.status(200).json({ message: `Berhasil melakukan ${action}` });
  } catch (err) {
    res.status(500).json({ message: "Gagal memproses review" });
  }
};

// 4. Pengajuan Pembubaran oleh Admin Sekolah
exports.requestSchoolDissolution = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { reason, evidence } = req.body;

    const realMemberCount = await User.countDocuments({
      sekolah: schoolId,
      peran: { $nin: ["BOT", "SUPER_ADMIN", "SYSTEM"] },
    });

    if (realMemberCount > 1) {
      return res.status(400).json({
        message: `Gagal: Masih ada ${realMemberCount} anggota (guru/siswa) di sekolah ini. Keluarkan mereka dahulu.`,
      });
    }

    await DissolveRequest.create({
      school: schoolId,
      requester: req.user._id,
      reason,
      evidence,
    });

    res
      .status(201)
      .json({ message: "Permintaan pembubaran dikirim ke Super Admin" });
  } catch (error) {
    res.status(500).json({ message: "Kesalahan Server: " + error.message });
  }
};

// src/controllers/superAdminController.js

// Ambil pengajuan pembubaran PENDING
exports.getPendingDissolutions = async (req, res) => {
  // 🔥 Tambahkan log ini untuk memastikan request masuk
  console.log("📩 Request masuk ke getPendingDissolutions");

  try {
    const requests = await DissolveRequest.find({ status: "PENDING" })
      .populate({
        path: "school",
        // Gunakan model name yang tepat (School)
        model: "School",
        select: "namaSekolah idSekolah npsn alamat",
      })
      .populate("requester", "namaPengguna email");

    console.log(`✅ Ditemukan ${requests.length} data pending`);
    res.status(200).json({ status: "success", data: requests });
  } catch (err) {
    console.error("🚨 Error Detail:", err);
    res.status(500).json({ message: "Gagal memproses data di server" });
  }
};

// Setujui Pembubaran (Aksi Destruktif Total)
exports.approveDissolution = async (req, res) => {
  const { requestId } = req.params;

  try {
    const request = await DissolveRequest.findById(requestId);
    if (!request || request.status !== "PENDING") {
      return res
        .status(404)
        .json({ message: "Request tidak valid atau sudah diproses" });
    }

    const schoolObjectId = request.school; // ObjectId: 69324108c7fde4fa1f10bb08

    // 1. Reset SEMUA User terkait (Kecuali Super Admin & Peneliti)
    // Gunakan field 'sekolah' sesuai UserSchema Anda
    await User.updateMany(
      {
        sekolah: schoolObjectId,
        peran: { $nin: ["SUPER_ADMIN", "PENELITI"] },
      },
      {
        $set: {
          sekolah: null,
          idSekolah: null,
          peran: "PENGGUNA",
          nis: null,
          adminRequestStatus: "NONE",
        },
      }
    );

    // 2. Cari semua ID Event milik sekolah ini
    // Berdasarkan data Anda, field di koleksi Event adalah 'sekolah' (ObjectId)
    const events = await Event.find({ sekolah: schoolObjectId });
    const eventIds = events.map((e) => e._id);

    // 3. Hapus Antrean (QueueEntry) berdasarkan ID Event yang ditemukan
    // Field di QueueEntry Anda adalah 'event'
    if (eventIds.length > 0) {
      const queueResult = await QueueEntry.deleteMany({
        event: { $in: eventIds },
      });
      console.log(`✅ Berhasil menghapus ${queueResult.deletedCount} antrean`);
    }

    // 4. Hapus Kegiatan (Event) milik sekolah
    const eventResult = await Event.deleteMany({ sekolah: schoolObjectId });
    console.log(`✅ Berhasil menghapus ${eventResult.deletedCount} kegiatan`);

    // 5. Hapus data Keanggotaan (SchoolMember) dan Sekolah itu sendiri
    await SchoolMember.deleteMany({ school: schoolObjectId });
    await School.findByIdAndDelete(schoolObjectId);

    // 6. Update status request pembubaran
    request.status = "APPROVED";
    await request.save();

    res.status(200).json({
      status: "success",
      message: "Sekolah, kegiatan, dan antrean berhasil dibersihkan total.",
    });
  } catch (error) {
    console.error("🚨 Error Pembubaran:", error);
    res
      .status(500)
      .json({ message: "Gagal melakukan pembubaran sistem: " + error.message });
  }
};

// 7. Tolak Request Pembubaran
exports.rejectDissolution = async (req, res) => {
  try {
    await DissolveRequest.findByIdAndUpdate(req.params.requestId, {
      status: "REJECTED",
    });
    res.json({ message: "Request pembubaran ditolak" });
  } catch (err) {
    res.status(500).json({ message: "Gagal menolak request pembubaran" });
  }
};

// 8. Utility: Get School by ID & Members
exports.getSchoolById = async (req, res) => {
  try {
    const school = await School.findById(req.params.schoolId);
    if (!school)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });
    res.status(200).json({ status: "success", data: school });
  } catch (err) {
    res.status(500).json({ message: "Server gagal memproses detail sekolah" });
  }
};

exports.getSchoolMembers = async (req, res) => {
  try {
    const school = await School.findById(req.params.schoolId);
    if (!school)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });

    const members = await User.find({ idSekolah: school.idSekolah })
      .select(
        "namaPengguna email peran fotoProfil nis noHp alamat jurusan tempatLahir tanggalLahir namaOrangTua kategoriSekolah kelas adminRequestStatus nip"
      )
      .sort({ peran: 1 });

    res.status(200).json({ status: "success", data: members });
  } catch (err) {
    res.status(500).json({ message: "Gagal mengambil daftar anggota" });
  }
};
