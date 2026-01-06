const Event = require("../models/Events");
const QueueEntry = require("../models/QueueEntry");
const User = require("../models/User");

const getUserFromToken = async (decodedToken) => {
  const user = await User.findOne({
    $or: [{ firebaseUid: decodedToken.uid }, { email: decodedToken.email }],
  }).populate("sekolah", "namaSekolah idSekolah");

  if (!user) {
    console.log("DEBUG AUTH: UID tidak ditemukan:", decodedToken.uid);
    throw new Error("User tidak ditemukan di database.");
  }
  return user;
};

exports.createEvent = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req.user);

    const {
      idKegiatan,
      namaKegiatan,
      kategori,
      waktuMulai,
      waktuSelesai,
      kapasitas,
      avgServiceMinutes,
      gracePeriodMinutes,
      statusKegiatan,
      deskripsi,
      lokasiKegiatan,
      thumbnailUrl,
    } = req.body;

    const numericFields = { kapasitas, avgServiceMinutes, gracePeriodMinutes };
    for (const [key, value] of Object.entries(numericFields)) {
      if (value !== undefined && isNaN(parseInt(value))) {
        return res.status(400).json({
          message: `Input '${key}' harus berupa angka valid.`,
        });
      }
    }

    if (currentUser.peran !== "ADMIN") {
      return res
        .status(403)
        .json({ message: "Hanya ADMIN yang boleh membuat event" });
    }

    if (!currentUser.sekolah) {
      return res
        .status(400)
        .json({ message: "Admin sekolah belum terkait data sekolah" });
    }

    if (!idKegiatan || !namaKegiatan) {
      return res
        .status(400)
        .json({ message: "idKegiatan dan namaKegiatan wajib diisi" });
    }

    const eventData = {
      idKegiatan,
      namaKegiatan,
      deskripsi,
      lokasiKegiatan,
      thumbnailUrl,
      sekolah: currentUser.sekolah._id || currentUser.sekolah,
      kategori: kategori || "LAINNYA",
      avgServiceMinutes: parseInt(avgServiceMinutes) || 5,
      gracePeriodMinutes: parseInt(gracePeriodMinutes) || 5,
      statusKegiatan: statusKegiatan || "TERBUKA",
      kapasitas: kapasitas ? parseInt(kapasitas) : null,
    };

    if (waktuMulai) {
      const dateStart = new Date(waktuMulai);
      if (isNaN(dateStart.getTime()))
        return res.status(400).json({ message: "Waktu mulai tidak valid" });
      eventData.waktuMulai = dateStart;
    }

    if (waktuSelesai) {
      const dateEnd = new Date(waktuSelesai);
      if (isNaN(dateEnd.getTime()))
        return res.status(400).json({ message: "Waktu selesai tidak valid" });
      eventData.waktuSelesai = dateEnd;
    }

    const eventBaru = await Event.create(eventData);
    res.status(201).json(eventBaru);
  } catch (error) {
    console.error("🚨 Create Event Error:", error);
    const status = error.code === 11000 ? 400 : 500;
    const message =
      error.code === 11000
        ? "ID Kegiatan sudah terdaftar"
        : "Gagal membuat event";
    res.status(status).json({ message });
  }
};

exports.getAllEvents = async (req, res) => {
  try {
    const currentUser = await getUserFromToken(req.user);
    const { idKegiatan, schoolId } = req.query;
    const q = {};

    if (currentUser.peran !== "SUPER_ADMIN" && currentUser.sekolah) {
      q.sekolah = currentUser.sekolah._id || currentUser.sekolah;
    } else if (schoolId) {
      q.sekolah = schoolId;
    }

    if (idKegiatan) q.idKegiatan = idKegiatan;

    const events = await Event.find(q)
      .populate("sekolah", "namaSekolah idSekolah")
      .lean();

    if (!events || events.length === 0) return res.json({ events: [] });

    const eventIds = events.map((e) => e._id);
    const queueAgg = await QueueEntry.aggregate([
      {
        $match: {
          event: { $in: eventIds },
          statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL"] },
        },
      },
      {
        $group: {
          _id: "$event",
          totalWaiting: { $sum: 1 },
          currentNumber: {
            $max: {
              $cond: [
                { $eq: ["$statusAntrian", "DIPANGGIL"] },
                "$nomorAntrian",
                0,
              ],
            },
          },
        },
      },
    ]);

    const waitingMap = {};
    queueAgg.forEach((doc) => {
      waitingMap[doc._id.toString()] = {
        totalWaiting: doc.totalWaiting || 0,
        currentNumber: doc.currentNumber > 0 ? doc.currentNumber : null,
      };
    });

    const result = events.map((ev) => {
      const stat = waitingMap[ev._id.toString()] || {
        totalWaiting: 0,
        currentNumber: null,
      };
      return {
        ...ev,
        totalWaiting: stat.totalWaiting,
        currentNumber: stat.currentNumber,
        slotsTaken: stat.totalWaiting,
        estimatedWaitMinutes: stat.totalWaiting * (ev.avgServiceMinutes || 5),
        kapasitas: ev.kapasitas ?? 50,
      };
    });

    res.json({ events: result });
  } catch (err) {
    console.error("🚨 Get Events Error:", err);
    res.status(500).json({ message: "Gagal memuat daftar kegiatan" });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const { statusKegiatan } = req.body;

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event tidak ditemukan" });
    }

    const user = await getUserFromToken(req.user);
    if (user.peran !== "SUPER_ADMIN") {
      if (
        !user.sekolah ||
        event.sekolah.toString() !== user.sekolah._id.toString()
      ) {
        return res.status(403).json({
          message: "DILARANG: Anda tidak memiliki akses ke event sekolah lain.",
        });
      }
    }

    if (statusKegiatan === "TERBUKA") {
      req.body.waktuMulai = null;
      req.body.waktuSelesai = null;
      req.body.isLocked = false;
    }

    if (statusKegiatan === "DITUTUP" && event.statusKegiatan !== "DITUTUP") {
      const now = new Date();
      req.body.waktuSelesai = new Date(now.getTime() + 15 * 60000);
      req.body.isLocked = true;
    }

    if (statusKegiatan === "SELESAI") {
      req.body.isLocked = true;
      await QueueEntry.updateMany(
        {
          event: eventId,
          statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA"] },
        },
        {
          $set: {
            statusAntrian: "TERLEWAT",
            alasanTunda: "Sesi pelayanan berakhir.",
            waktuSelesai: new Date(),
          },
        }
      );
    }

    const eventUpdated = await Event.findByIdAndUpdate(
      eventId,
      { $set: req.body },
      { new: true }
    );

    if (statusKegiatan) {
      const topic = `school_${event.sekolah}`;
      sendTopicNotification(
        topic,
        "Update Layanan 🔔",
        `Layanan ${event.namaKegiatan} kini berstatus: ${statusKegiatan}`,
        { eventId: eventId, status: statusKegiatan }
      );
    }

    res.json({ message: "Berhasil diperbarui", event: eventUpdated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId);

    if (!event)
      return res.status(404).json({ message: "Event tidak ditemukan" });

    const user = await getUserFromToken(req.user);

    if (user.peran !== "SUPER_ADMIN") {
      if (user.peran !== "ADMIN")
        return res.status(403).json({ message: "Akses ditolak" });

      if (
        !user.sekolah ||
        event.sekolah.toString() !== user.sekolah._id.toString()
      ) {
        return res.status(403).json({
          message: "DILARANG: Anda tidak berhak menghapus event sekolah lain.",
        });
      }
    }

    await Event.deleteOne({ _id: eventId });
    await QueueEntry.deleteMany({ event: eventId });

    res.json({
      message: "Kegiatan dan semua antrean terkait berhasil dihapus",
    });
  } catch (error) {
    console.error("🚨 Delete Event Error:", error);
    res.status(500).json({ message: "Gagal menghapus kegiatan" });
  }
};

exports.toggleEventLock = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event)
      return res.status(404).json({ message: "Layanan tidak ditemukan" });

    const user = await getUserFromToken(req.user);
    if (user.peran !== "SUPER_ADMIN") {
      if (
        !user.sekolah ||
        event.sekolah.toString() !== user.sekolah._id.toString()
      ) {
        return res
          .status(403)
          .json({ message: "DILARANG: Bukan sekolah Anda." });
      }
    }

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
