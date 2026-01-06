const School = require("../models/School");
const User = require("../models/User");
const Event = require("../models/Events");
const QueueEntry = require("../models/QueueEntry");
const SchoolMember = require("../models/SchoolMember");
const DissolveRequest = require("../models/DissolveRequest");
const mongoose = require("mongoose");

exports.getAllSchools = async (req, res) => {
  try {
    const allSchools = await School.find().sort({ namaSekolah: 1 });

    const filtered = allSchools.filter((s) => s.penyediaAntrian === true);

    console.log(
      `🔍 DEBUG: Total ${allSchools.length}, Lolos Filter: ${filtered.length}`
    );

    res.status(200).json({
      status: "success",
      data: filtered,
    });
  } catch (err) {
    res.status(500).json({ message: "Gagal mengambil daftar sekolah" });
  }
};

exports.getPendingSchools = async (req, res) => {
  try {
    const pendingSchools = await School.find({ penyediaAntrian: false });

    const data = await Promise.all(
      pendingSchools.map(async (school) => {
        let userPengaju = null;

        try {
          if (school.createdBy) {
            userPengaju = await User.findById(school.createdBy).select(
              "namaPengguna email fotoProfil"
            );
          }
        } catch (e) {
          console.warn(
            "⚠️ User createdBy tidak valid:",
            school.createdBy?.toString()
          );
        }

        return {
          school,
          user: userPengaju ?? {
            _id: null,
            namaPengguna: "User tidak ditemukan",
          },
        };
      })
    );

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (err) {
    console.error("🚨 getPendingSchools ERROR:", err);
    res.status(500).json({
      message: "Server gagal memproses daftar pendaftaran",
    });
  }
};

exports.reviewSchoolRequest = async (req, res) => {
  const { schoolId, userId, action } = req.body;
  try {
    const school = await School.findById(schoolId);
    if (!school)
      return res.status(404).json({ message: "Sekolah tidak ditemukan" });

    const targetUser = await User.findById(userId);

    if (action === "APPROVE") {
      school.penyediaAntrian = true;
      await school.save();

      await User.findByIdAndUpdate(userId, {
        peran: "ADMIN",
        idSekolah: school.idSekolah,
        sekolah: school._id,
      });

      await SchoolMember.findOneAndUpdate(
        { school: school._id, user: userId },
        { status: "approved", role: "admin" },
        { upsert: true }
      );
    } else {
      await SchoolMember.deleteMany({ school: schoolId });
      await School.findByIdAndDelete(schoolId);
    }

    res.status(200).json({ message: `Berhasil melakukan ${action}` });
  } catch (err) {
    res.status(500).json({ message: "Gagal memproses review: " + err.message });
  }
};

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

exports.getPendingDissolutions = async (req, res) => {
  console.log("📩 Request masuk ke getPendingDissolutions");

  try {
    const requests = await DissolveRequest.find({ status: "PENDING" })
      .populate({
        path: "school",

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

exports.approveDissolution = async (req, res) => {
  const { requestId } = req.params;

  try {
    const request = await DissolveRequest.findById(requestId);
    if (!request || request.status !== "PENDING") {
      return res
        .status(404)
        .json({ message: "Request tidak valid atau sudah diproses" });
    }

    const schoolObjectId = request.school;

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
          adminRequestStatus: "NONE",
        },
        $unset: {
          nis: "",
          kelas: "",
          jurusan: "",
          kategoriSekolah: "",
        },
      }
    );

    const events = await Event.find({ sekolah: schoolObjectId });
    const eventIds = events.map((e) => e._id);

    if (eventIds.length > 0) {
      const queueResult = await QueueEntry.deleteMany({
        event: { $in: eventIds },
      });
      console.log(`✅ Berhasil menghapus ${queueResult.deletedCount} antrean`);
    }

    const eventResult = await Event.deleteMany({ sekolah: schoolObjectId });
    console.log(`✅ Berhasil menghapus ${eventResult.deletedCount} kegiatan`);

    await SchoolMember.deleteMany({ school: schoolObjectId });
    await School.findByIdAndDelete(schoolObjectId);

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

exports.getSchoolById = async (req, res) => {
  console.log("🚨 MASUK getSchoolById, schoolId =", req.params.schoolId);
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
