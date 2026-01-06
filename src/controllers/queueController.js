const mongoose = require("mongoose");
const User = require("../models/User");
const QueueEntry = require("../models/QueueEntry");
const Event = require("../models/Events");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const ExcelJS = require("exceljs");
const {
  sendPushNotification,
  sendTopicNotification,
} = require("../utils/notificationHelper");

const SECRET_KEY = process.env.JWT_SECRET;

const formatWaitTime = (totalMinutes) => {
  if (totalMinutes < 1) return "Segera";
  if (totalMinutes < 60) return `${totalMinutes} m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} j ${mins} m` : `${hours} j`;
};

// Lokasi: src/controllers/queueController.js

const processAutoActions = async (eventId) => {
  try {
    const event = await Event.findById(eventId);
    if (!event) return;

    const now = new Date();

    // --- BAGIAN 1: LOGIKA AUTO-SKIP (TETAP DIPERTAHANKAN) ---
    const expiredCall = await QueueEntry.findOne({
      event: eventId,
      statusAntrian: "DIPANGGIL",
      waktuKadaluarsa: { $lt: now },
    });

    if (expiredCall) {
      expiredCall.statusAntrian = "TERLEWAT";
      expiredCall.alasanTunda = "Tidak hadir (Auto-Skip)";
      expiredCall.waktuSelesai = now;
      await expiredCall.save();

      const nextQueue = await QueueEntry.findOne({
        event: eventId,
        statusAntrian: "MENUNGGU",
      }).sort({ nomorAntrian: 1 });

      if (nextQueue) {
        const duration = event.avgServiceMinutes || 5;
        nextQueue.statusAntrian = "DIPANGGIL";
        nextQueue.waktuPanggil = now;
        nextQueue.waktuKadaluarsa = new Date(now.getTime() + duration * 60000);
        await nextQueue.save();
        if (nextQueue.pengguna && nextQueue.pengguna.fcmToken) {
          sendPushNotification(
            nextQueue.pengguna.fcmToken,
            "Giliran Anda (Auto)! 📢",
            `Antrian sebelumnya dilewati. Nomor #${nextQueue.nomorAntrian} silakan merapat.`,
            { type: "AUTO_CALL", eventId: eventId }
          );
        }
      }
    }

    // --- BAGIAN 2: LOGIKA TERMINASI SESI (DENGAN PERBAIKAN) ---
    const isTimeOver = event.waktuSelesai && now > new Date(event.waktuSelesai);
    const isManuallyFinished = event.statusKegiatan === "SELESAI";

    if (isTimeOver || isManuallyFinished) {
      // 1. Sinkronisasi Status: Paksa DITUTUP menjadi SELESAI jika waktu habis
      if (isTimeOver && event.statusKegiatan !== "SELESAI") {
        event.statusKegiatan = "SELESAI";
        event.isLocked = true;
        // Jangan di-save di sini dulu, kita save sekaligus di akhir
      }

      // 2. 🔥 FIX ANTREAN HANTU: Tambahkan "DILAYANI" ke daftar yang akan dihapus
      const activeStatuses = ["MENUNGGU", "REQ_TUNDA", "DIPANGGIL", "DILAYANI"];

      const toArchiveCount = await QueueEntry.countDocuments({
        event: eventId,
        statusAntrian: { $in: activeStatuses },
      });

      if (toArchiveCount > 0) {
        await QueueEntry.updateMany(
          { event: eventId, statusAntrian: { $in: activeStatuses } },
          {
            $set: {
              statusAntrian: "TERLEWAT",
              alasanTunda: isManuallyFinished
                ? "Sesi diakhiri petugas"
                : "Waktu layanan berakhir otomatis",
              waktuSelesai: now,
            },
          }
        );
      }

      await event.save(); // Simpan perubahan status SELESAI dan slotsTaken: 0
      console.log(
        `✅ Sesi ${event.namaKegiatan} dibersihkan. Kapasitas direset ke 0.`
      );
    }
  } catch (err) {
    console.error("🚨 System Error [processAutoActions]:", err);
  }
};

exports.joinQueue = async (req, res) => {
  try {
    const eventId = req.params.eventId || req.body.eventIdKegiatan;

    if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "ID Layanan tidak valid." });
    }

    const user = req.user;
    if (!user || !user._id) {
      return res.status(401).json({ message: "User tidak valid." });
    }

    // 1. 🔥 ATOMIC UPDATE: Amankan slot dulu
    const updatedEvent = await Event.findByIdAndUpdate(
      eventId,
      { $inc: { lastNumberIssued: 1, slotsTaken: 1 } },
      { new: true, runValidators: true }
    );

    if (!updatedEvent) {
      return res.status(404).json({ message: "Layanan tidak ditemukan" });
    }

    // ============================================================
    // 🛡️ SECURITY PATCH: CEK VALIDASI SEKOLAH (ANTI-CURANG)
    // ============================================================

    // 1. Cek apakah user punya sekolah (menangani kasus user baru di-KICK)
    if (!user.sekolah) {
      // ROLLBACK SLOT
      await Event.findByIdAndUpdate(eventId, {
        $inc: { lastNumberIssued: -1, slotsTaken: -1 },
      });
      return res
        .status(403)
        .json({ message: "Gagal: Anda tidak terdaftar di sekolah manapun." });
    }

    // 2. Cek apakah sekolah user SAMA dengan sekolah penyelenggara event
    // Gunakan .toString() untuk membandingkan ObjectId dengan aman
    if (user.sekolah.toString() !== updatedEvent.sekolah.toString()) {
      // ROLLBACK SLOT
      await Event.findByIdAndUpdate(eventId, {
        $inc: { lastNumberIssued: -1, slotsTaken: -1 },
      });
      return res
        .status(403)
        .json({
          message: "Gagal: Anda bukan anggota sekolah penyelenggara ini.",
        });
    }
    // ============================================================

    // 2. 🔥 VALIDASI STATUS EVENT (Lanjutan)
    const status = updatedEvent.dynamicStatus;
    const isOverbooked =
      updatedEvent.kapasitas &&
      updatedEvent.slotsTaken > updatedEvent.kapasitas;

    if (status === "DITUTUP" || status === "SELESAI" || isOverbooked) {
      // Rollback
      await Event.findByIdAndUpdate(eventId, {
        $inc: { lastNumberIssued: -1, slotsTaken: -1 },
      });

      let message = `Gagal! Pendaftaran sedang ${status}.`;
      if (isOverbooked) message = "Gagal! Kuota pendaftaran sudah penuh.";

      return res.status(403).json({ message: message });
    }

    // 3. Cek Duplikat User
    const batchAktif = updatedEvent.currentBatch || 1;

    const existing = await QueueEntry.findOne({
      event: eventId,
      pengguna: user._id,
      batch: batchAktif,
      statusAntrian: {
        $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA", "DILAYANI"],
      },
    });

    if (existing) {
      // Rollback
      await Event.findByIdAndUpdate(eventId, {
        $inc: { lastNumberIssued: -1, slotsTaken: -1 },
      });
      return res
        .status(400)
        .json({ message: "Anda sudah memiliki antrean aktif." });
    }

    // 4. Buat Tiket Baru
    const newEntry = new QueueEntry({
      event: eventId,
      pengguna: user._id,
      nomorAntrian: updatedEvent.lastNumberIssued,
      batch: batchAktif,
      statusAntrian: "MENUNGGU",
    });

    newEntry.qrExpiresAt = new Date(Date.now() + 5 * 60000);
    // Pastikan SECRET_KEY sudah di-import/defined
    newEntry.qrToken = jwt.sign(
      { qid: newEntry._id, eid: eventId },
      process.env.JWT_SECRET || "rahasia_negara", // Pastikan pakai env yang benar
      { expiresIn: "5m" }
    );

    await newEntry.save();

    res.status(201).json({ success: true, queueEntry: newEntry });
  } catch (err) {
    console.error("🚨 System Error [joinQueue]:", err);
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Sistem sibuk, silakan klik daftar kembali." });
    }
    res.status(500).json({ message: "Gagal bergabung antrean." });
  }
};

exports.resetQueueCounter = async (req, res) => {
  const { eventId, newAvgTime } = req.body;

  try {
    const event = await Event.findById(eventId);
    if (!event)
      return res.status(404).json({ message: "Layanan tidak ditemukan" });

    // 🔥 LOGIKA 1: CEK BATCH KOSONG (Resume Batch Lama)
    if (
      (!event.slotsTaken || event.slotsTaken === 0) &&
      (!event.lastNumberIssued || event.lastNumberIssued === 0)
    ) {
      const updateSimple = {
        statusKegiatan: "TERBUKA",
        isLocked: false,
        // 👇 WAJIB DI-RESET AGAR SWITCH MAU NYALA
        waktuMulai: null,
        waktuSelesai: null,
      };

      if (newAvgTime && !isNaN(newAvgTime) && newAvgTime > 0) {
        updateSimple.avgServiceMinutes = newAvgTime;
      }

      const reOpened = await Event.findByIdAndUpdate(eventId, updateSimple, {
        new: true,
      });

      return res.status(200).json({
        success: true,
        message: `Layanan dibuka kembali (Melanjutkan Batch #${reOpened.currentBatch}).`,
        currentBatch: reOpened.currentBatch,
      });
    }

    // 🔥 LOGIKA 2: AUTO-CLEAN (Pindahkan sisa antrean ke TERLEWAT)
    const activeFilter = {
      event: eventId,
      statusAntrian: {
        $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA", "DILAYANI"],
      },
    };

    const activeCount = await QueueEntry.countDocuments(activeFilter);

    if (activeCount > 0) {
      await QueueEntry.updateMany(activeFilter, {
        $set: {
          statusAntrian: "TERLEWAT",
          alasanTunda: "Admin memulai Sesi/Batch Baru",
          waktuSelesai: new Date(),
        },
      });
    }

    // --- PROSES RESET KE BATCH BARU ---
    const nextBatch = (event.currentBatch || 1) + 1;

    const updateData = {
      currentBatch: nextBatch,
      lastNumberIssued: 0,
      slotsTaken: 0,
      statusKegiatan: "TERBUKA",
      isLocked: false,
      // 👇 WAJIB DI-RESET JUGA DI SINI
      waktuMulai: null,
      waktuSelesai: null,

      totalServed: 0,
      totalServiceDuration: 0,
    };

    if (newAvgTime && !isNaN(newAvgTime) && newAvgTime > 0) {
      updateData.avgServiceMinutes = newAvgTime;
    }

    const updated = await Event.findByIdAndUpdate(
      eventId,
      { $set: updateData },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: `Sesi Baru Batch #${updated.currentBatch} dimulai!`,
      currentBatch: updated.currentBatch,
    });
  } catch (err) {
    console.error("🚨 Error Reset:", err);
    res.status(500).json({ message: "Gagal mereset antrean." });
  }
};

exports.getMyQueues = async (req, res) => {
  try {
    // 🔥 FIX: Pakai req.user langsung
    const user = req.user;
    if (!user)
      return res.status(404).json({ message: "Pengguna tidak ditemukan" });

    const allQueues = await QueueEntry.find({ pengguna: user._id }) // ✅ Pakai _id
      .populate(
        "event",
        "namaKegiatan idKegiatan namaSekolah statusKegiatan avgServiceMinutes lokasiKegiatan"
      )
      .sort({ waktuDaftar: -1 });

    const activeStatuses = ["MENUNGGU", "DIPANGGIL", "DILAYANI", "REQ_TUNDA"];
    const current = [];
    const history = [];

    allQueues.forEach((q) => {
      if (activeStatuses.includes(q.statusAntrian)) current.push(q);
      else history.push(q);
    });

    res.json({ current, history });
  } catch (err) {
    console.error("🚨 System Error [getMyQueues]:", err);
    res.status(500).json({ message: "Gagal memuat daftar antrean." });
  }
};

exports.getQueueDetail = async (req, res) => {
  try {
    const { queueId } = req.params;

    // 1. Ambil data antrean user ini
    const myQueue = await QueueEntry.findById(queueId).populate("event");

    if (!myQueue) {
      return res.status(404).json({
        status: "error",
        message: "Antrean tidak ditemukan",
      });
    }

    // 2. 🔥 HITUNG JUMLAH ORANG DI DEPAN (Ini yang bikin frontend lu error sebelumnya)
    // Logika: Hitung berapa orang yang statusnya MENUNGGU dan daftarnya LEBIH DULU dari user ini
    const peopleAhead = await QueueEntry.countDocuments({
      event: myQueue.event._id,
      statusAntrian: "MENUNGGU",
      waktuDaftar: { $lt: myQueue.waktuDaftar }, // $lt = Less Than (Lebih dulu)
    });

    // 3. 🔥 HITUNG ESTIMASI WAKTU
    // Ambil rata-rata waktu layanan dari event (default 5 menit)
    const avgTime = myQueue.event.avgServiceMinutes || 5;
    const estimatedMinutes = peopleAhead * avgTime;

    // Tambahkan menit ke waktu sekarang
    const estimatedTime = new Date();
    estimatedTime.setMinutes(estimatedTime.getMinutes() + estimatedMinutes);

    // 4. Kirim Data Lengkap ke Flutter
    res.json({
      status: "success",
      data: {
        _id: myQueue._id,
        nomorAntrian: myQueue.nomorAntrian,
        statusAntrian: myQueue.statusAntrian,
        qrToken: myQueue.qrToken,
        waktuDaftar: myQueue.waktuDaftar,
        event: myQueue.event,

        // 👇 DUA INI YANG DITUNGGU FLUTTER
        peopleAhead: peopleAhead,
        estimatedTime: estimatedTime,
      },
    });
  } catch (err) {
    console.error("🚨 Error getQueueDetail:", err);
    res.status(500).json({ status: "error", message: "Server Error" });
  }
};

exports.getAdminDashboard = async (req, res) => {
  try {
    const { eventId } = req.params;
    const eventObj = await Event.findById(eventId);
    if (!eventObj)
      return res.status(404).json({ message: "Event tidak ditemukan" });

    const batchAktif = eventObj.currentBatch || 1;
    const queryFilter = { event: eventObj._id, batch: batchAktif };
    const totalCapacityUsed = eventObj.slotsTaken || 0;
    const waiting = await QueueEntry.find({
      ...queryFilter,
      statusAntrian: { $in: ["MENUNGGU", "REQ_TUNDA"] },
    })
      .sort({ nomorAntrian: 1 })
      .populate("pengguna");
    const serving = await QueueEntry.findOne({
      ...queryFilter,
      statusAntrian: "DILAYANI",
    }).populate("pengguna");
    const called = await QueueEntry.findOne({
      ...queryFilter,
      statusAntrian: "DIPANGGIL",
    }).populate("pengguna");

    res.status(200).json({
      serving,
      called,
      waiting,

      currentBatch: batchAktif,
      lastNumberIssued: eventObj.lastNumberIssued || 0,
      summary: {
        menunggu: waiting.filter((q) => q.statusAntrian === "MENUNGGU").length,
        reqTunda: waiting.filter((q) => q.statusAntrian === "REQ_TUNDA").length,
        dipanggil: called ? 1 : 0,
        dilayani: serving ? 1 : 0,
        total: eventObj.slotsTaken || 0,
        total: totalCapacityUsed,
      },
    });
  } catch (err) {
    console.error("🚨 System Error [getAdminDashboard]:", err);
    res.status(500).json({ message: "Gagal memuat dashboard admin." });
  }
};

exports.adminCallNext = async (req, res) => {
  const { eventId } = req.body;
  try {
    const event = await Event.findById(eventId);
    if (!event)
      return res.status(404).json({ message: "Event tidak ditemukan" });

    // 1. Validasi Status Akhir
    if (
      event.dynamicStatus === "SELESAI" ||
      event.dynamicStatus === "BERLALU"
    ) {
      return res
        .status(403)
        .json({ message: "Sesi sudah berakhir, tidak bisa memanggil lagi." });
    }

    const isReadyToServe = event.isLocked || event.statusKegiatan === "DITUTUP";

    if (!isReadyToServe) {
      return res.status(403).json({
        message:
          "Kunci pendaftaran atau tutup sesi terlebih dahulu sebelum mulai memanggil pendaftar.",
      });
    }

    const currentServing = await QueueEntry.findOne({
      event: event._id,
      statusAntrian: { $in: ["DIPANGGIL", "DILAYANI"] },
    });

    if (currentServing) {
      return res.status(200).json({
        message:
          "Selesaikan antrean nomor #" +
          currentServing.nomorAntrian +
          " terlebih dahulu.",
        currentQueue: currentServing,
      });
    }

    const nextQueue = await QueueEntry.findOne({
      event: event._id,
      batch: event.currentBatch || 1,
      statusAntrian: "MENUNGGU",
    })
      .sort({ nomorAntrian: 1 })
      .populate("pengguna", "namaPengguna");

    if (!nextQueue)
      return res.status(404).json({ message: "Antrean sedang kosong." });

    const graceDuration = event.gracePeriodMinutes || 5;
    nextQueue.statusAntrian = "DIPANGGIL";
    nextQueue.waktuPanggil = new Date();
    nextQueue.waktuKadaluarsa = new Date(Date.now() + graceDuration * 60000);

    await nextQueue.save();

    if (nextQueue.pengguna && nextQueue.pengguna.fcmToken) {
      sendPushNotification(
        nextQueue.pengguna.fcmToken,
        "Giliran Anda! 📢",
        `Nomor #${nextQueue.nomorAntrian} silakan menuju lokasi layanan.`,
        { type: "CALLING", eventId: eventId }
      );
    }

    // 🔥 NOTIFIKASI 2: Antrian Mendekat (Ke orang ke-2 di daftar tunggu)
    const upcomingUser = await QueueEntry.findOne({
      event: event._id,
      statusAntrian: "MENUNGGU",
    })
      .sort({ nomorAntrian: 1 })
      .populate("pengguna");

    if (
      upcomingUser &&
      upcomingUser.pengguna &&
      upcomingUser.pengguna.fcmToken
    ) {
      sendPushNotification(
        upcomingUser.pengguna.fcmToken,
        "Siap-siap! ⏳",
        "1-2 orang lagi giliran Anda. Mohon mendekat ke lokasi.",
        { type: "NEARBY", eventId: eventId }
      );
    }

    res.status(200).json({
      message: `Memanggil #${nextQueue.nomorAntrian}. Batas hadir ${graceDuration} menit.`,
      data: nextQueue,
    });
  } catch (error) {
    console.error("🚨 Error [adminCallNext]:", error);
    res
      .status(500)
      .json({ message: "Terjadi kesalahan sistem saat memanggil antrean." });
  }
};

exports.adminSkipQueue = async (req, res) => {
  const { eventId, currentQueueId } = req.body;
  try {
    const event = await Event.findById(eventId);
    if (!event || !event.isLocked)
      return res.status(403).json({ message: "Event harus dikunci." });

    const queueToSkip = await QueueEntry.findById(currentQueueId);
    if (!queueToSkip)
      return res.status(404).json({ message: "Antrean tidak ditemukan" });

    queueToSkip.statusAntrian = "TERLEWAT";
    queueToSkip.waktuSelesai = new Date();
    queueToSkip.waktuKadaluarsa = null;
    await queueToSkip.save();

    const nextInLine = await QueueEntry.findOne({
      event: event._id,
      statusAntrian: "MENUNGGU",
    }).sort({ nomorAntrian: 1 });

    let newCalled = null;
    if (nextInLine) {
      const duration = event.avgServiceMinutes || 5;
      nextInLine.statusAntrian = "DIPANGGIL";
      nextInLine.waktuPanggil = new Date();
      nextInLine.waktuKadaluarsa = new Date(Date.now() + duration * 60000);
      await nextInLine.save();
      newCalled = nextInLine;
    }

    res.status(200).json({
      message: "Antrean dilewatkan. Memanggil berikutnya.",
      skipped: queueToSkip,
      nextCalled: newCalled,
    });
  } catch (error) {
    console.error("🚨 System Error [adminSkipQueue]:", error);
    res.status(500).json({ message: "Gagal melewati antrean." });
  }
};

exports.adminCompleteQueue = async (req, res) => {
  const { queueId } = req.body;
  try {
    const queue = await QueueEntry.findById(queueId);
    if (!queue)
      return res.status(404).json({ message: "Antrean tidak ditemukan" });

    queue.statusAntrian = "SELESAI";
    queue.waktuSelesaiLayanan = new Date();
    queue.qrToken = null;
    await queue.save();

    if (queue.waktuMulaiLayanan) {
      const durasiDetik = Math.max(
        60,
        Math.floor((queue.waktuSelesaiLayanan - queue.waktuMulaiLayanan) / 1000)
      );
      const event = await Event.findById(queue.event);
      if (event) {
        event.totalServed = (event.totalServed || 0) + 1;
        event.totalServiceDuration =
          (event.totalServiceDuration || 0) + durasiDetik;
        event.avgServiceMinutes = Math.ceil(
          event.totalServiceDuration / 60 / event.totalServed
        );
        await event.save();
      }
    }
    res.status(200).json({
      message: "Layanan selesai, kuota pendaftaran tetap terisi (Status 1).",
    });
  } catch (err) {
    console.error("🚨 System Error [adminCompleteQueue]:", err);
    res.status(500).json({ message: "Gagal menyelesaikan layanan." });
  }
};

exports.adminRespondPostpone = async (req, res) => {
  const { queueId } = req.params;
  const { action } = req.body;

  try {
    const oldQueue = await QueueEntry.findById(queueId);
    if (!oldQueue)
      return res.status(404).json({ message: "Antrean tidak ditemukan" });

    // Gunakan Atomic Update untuk Event agar aman dari Race Condition
    const event = await Event.findById(oldQueue.event);
    const batchAktif = event.currentBatch || 1;

    if (action === "APPROVE") {
      // 1. Antrean Lama jadi TERLEWAT (Beban kerja admin sudah terpakai di sini)
      oldQueue.statusAntrian = "TERLEWAT";
      oldQueue.alasanTunda =
        (oldQueue.alasanTunda || "") + " (Tunda disetujui)";
      await oldQueue.save();

      // 2. Update Event: Naikkan Nomor Terakhir & TAMBAH SlotsTaken (+1)
      // 🔥 FIX: Jangan hitung ulang (countDocuments), cukup tambah 1 slot baru.
      const updatedEvent = await Event.findByIdAndUpdate(
        event._id,
        {
          $inc: {
            lastNumberIssued: 1,
            slotsTaken: 1, // Tambah 1 karena ada antrean baru yang terbentuk
          },
        },
        { new: true } // Ambil data terbaru
      );

      const nextNumber = updatedEvent.lastNumberIssued;

      // 3. Buat Antrean Baru
      const newQueue = new QueueEntry({
        event: event._id,
        pengguna: oldQueue.pengguna,
        nomorAntrian: nextNumber,
        batch: batchAktif,
        statusAntrian: "MENUNGGU",
        isPostponed: true,
        alasanTunda: oldQueue.alasanTunda,
        waktuDaftar: new Date(),
      });

      await newQueue.save();

      // ❌ HAPUS BAGIAN countDocuments DI SINI ❌
      // (Kode lama yang menghancurkan kapasitas dihapus total)

      res.status(200).json({
        message: `Berhasil. Nomor #${oldQueue.nomorAntrian} dilewatkan, User kini di nomor #${nextNumber}.`,
        data: newQueue,
      });
    } else {
      // Logic Tolak (REJECT)
      oldQueue.statusAntrian = "MENUNGGU";
      await oldQueue.save();
      res.status(200).json({
        message: "Permintaan tunda ditolak. User kembali ke daftar tunggu.",
      });
    }
  } catch (error) {
    console.error("🚨 System Error [adminRespondPostpone]:", error);
    res.status(500).json({ message: "Gagal menanggapi permintaan tunda." });
  }
};

exports.validateQrAndStartService = async (req, res) => {
  const { eventId } = req.body;
  const qrToken = req.body.qrToken || req.body.qr_code;

  try {
    // 1. Validasi format ID MongoDB
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        valid: false,
        message:
          "Format ID Kegiatan salah. Aplikasi Admin harus kirim Internal ID.",
      });
    }

    // 2. 🔥 PROTEKSI UTAMA: Cek Status Kegiatan Sebelum Scan
    // Ambil data event untuk melihat apakah sudah masa pendaftaran atau belum
    const event = await Event.findById(eventId);
    if (!event) {
      return res
        .status(404)
        .json({ valid: false, message: "Kegiatan tidak ditemukan" });
    }

    // Cek status menggunakan getter virtual dynamicStatus yang sudah kita buat
    if (event.dynamicStatus === "PRE-ORDER") {
      return res.status(403).json({
        valid: false,
        message: "Gagal! Sesi pelayanan belum dimulai (Masih masa Pre-Order).",
      });
    }

    if (event.dynamicStatus === "SELESAI") {
      return res.status(403).json({
        valid: false,
        message: "Gagal! Sesi pelayanan untuk kegiatan ini sudah berakhir.",
      });
    }

    // 3. Verifikasi Token QR
    const decoded = jwt.verify(qrToken, SECRET_KEY);

    // Cari data antrean berdasarkan ID dari Token dan ID Kegiatan
    const queueEntry = await QueueEntry.findOne({
      _id: decoded.qid,
      event: eventId,
    }).populate("pengguna");

    if (!queueEntry) {
      return res
        .status(404)
        .json({ valid: false, message: "QR tidak ditemukan di kegiatan ini" });
    }

    // 4. Validasi Status Antrean User
    const blockedStatuses = ["SELESAI", "BATAL", "TERLEWAT", "DIBATALKAN"];
    if (blockedStatuses.includes(queueEntry.statusAntrian)) {
      return res.status(400).json({
        valid: false,
        message: `Antrean sudah ${queueEntry.statusAntrian}`,
      });
    }

    // 5. Cek Giliran (FIFO)
    if (queueEntry.statusAntrian !== "DILAYANI") {
      const peopleAhead = await QueueEntry.countDocuments({
        event: eventId,
        statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL"] },
        nomorAntrian: { $lt: queueEntry.nomorAntrian },
      });

      if (peopleAhead > 0) {
        return res.status(400).json({
          valid: false,
          message: `Belum giliran. Ada ${peopleAhead} orang di depan.`,
        });
      }

      // Mulai pelayanan jika semua syarat terpenuhi
      queueEntry.statusAntrian = "DILAYANI";
      queueEntry.waktuMulaiLayanan = new Date();
      await queueEntry.save();
    }

    // 6. Kirim Respon Berhasil
    res.json({
      valid: true,
      message: "Berhasil memuat data layanan",
      data: {
        queueId: queueEntry._id,
        namaUser: queueEntry.pengguna?.namaPengguna || "Guest",
        nomorAntrian: queueEntry.nomorAntrian,
        status: queueEntry.statusAntrian,
        waktuMulaiLayanan: queueEntry.waktuMulaiLayanan,
      },
    });
  } catch (err) {
    console.error("🚨 Scan Error:", err.message);
    return res.status(400).json({
      valid: false,
      message: "QR Code kedaluwarsa atau tidak valid",
    });
  }
};

exports.checkEventBeforeJoin = async (req, res) => {
  try {
    const { code } = req.params;

    const event = mongoose.Types.ObjectId.isValid(code)
      ? await Event.findById(code)
      : await Event.findOne({ idKegiatan: code });

    if (!event) {
      return res.status(404).json({ message: "Layanan tidak ditemukan" });
    }

    const batchAktif = event.currentBatch || 1;

    const waitingCount = await QueueEntry.countDocuments({
      event: event._id,
      batch: batchAktif,
      statusAntrian: "MENUNGGU",
    });
    const activeServing = await QueueEntry.findOne({
      event: event._id,
      batch: batchAktif,
      statusAntrian: "DILAYANI",
    }).select("nomorAntrian");

    const data = event.toObject();
    data.slotsTaken = event.slotsTaken || 0;

    data.totalWaiting = waitingCount;
    data.currentNumber = activeServing ? activeServing.nomorAntrian : 0;

    res.status(200).json({ status: "success", data });
  } catch (error) {
    console.error("🚨 System Error [checkEventBeforeJoin]:", error);
    res.status(500).json({ message: "Gagal mengecek informasi layanan." });
  }
};

exports.adminServeQueue = async (req, res) => {
  const { qrToken } = req.body;
  try {
    const queue = await QueueEntry.findOne({ qrToken: qrToken });
    if (!queue)
      return res.status(404).json({ message: "QR Code tidak valid." });

    if (queue.statusAntrian !== "DIPANGGIL") {
      return res
        .status(400)
        .json({ message: `Status ${queue.statusAntrian}, harus DIPANGGIL.` });
    }

    queue.statusAntrian = "DILAYANI";
    queue.waktuMulaiLayanan = new Date();
    queue.waktuKadaluarsa = null;
    await queue.save();

    res
      .status(200)
      .json({ message: "Layanan dimulai secara manual.", data: queue });
  } catch (err) {
    console.error("🚨 System Error [adminServeQueue]:", err);
    res.status(500).json({ message: "Gagal memulai layanan manual." });
  }
};

exports.refreshQrToken = async (req, res) => {
  const { queueId } = req.params;

  // 🔥 FIX: Ambil data user dari middleware
  const user = req.user;

  try {
    const queue = await QueueEntry.findById(queueId);
    if (!queue)
      return res.status(404).json({ message: "Data tidak ditemukan" });

    // Validasi Pemilik
    if (!user || queue.pengguna.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "Akses ditolak." });
    }

    const newToken = jwt.sign(
      { qid: queue._id, eid: queue.event },
      SECRET_KEY,
      { expiresIn: "5m" }
    );
    queue.qrToken = newToken;
    queue.qrExpiresAt = new Date(Date.now() + 5 * 60000);
    await queue.save();

    res.json({ token: newToken, expiry: queue.qrExpiresAt });
  } catch (err) {
    console.error("🚨 System Error [refreshQrToken]:", err);
    res.status(500).json({ message: "Gagal memperbarui QR Token." });
  }
};

exports.userPostponeQueue = async (req, res) => {
  try {
    const queue = await QueueEntry.findById(req.params.queueId);
    if (queue.statusAntrian !== "MENUNGGU") {
      return res
        .status(400)
        .json({ message: "Hanya status MENUNGGU yang bisa tunda." });
    }
    queue.statusAntrian = "REQ_TUNDA";
    queue.alasanTunda = req.body.alasan || "User Request";
    await queue.save();
    res.status(200).json({ message: "Permintaan tunda berhasil dikirim." });
  } catch (err) {
    console.error("🚨 System Error [userPostponeQueue]:", err);
    res.status(500).json({ message: "Gagal mengirim permintaan tunda." });
  }
};

exports.userCancelQueue = async (req, res) => {
  try {
    const { queueId } = req.params;
    const entry = await QueueEntry.findById(queueId).populate("event");
    if (!entry)
      return res.status(404).json({ message: "Antrean tidak ditemukan" });

    const event = entry.event;
    const isPreOrder = event.dynamicStatus === "PRE-ORDER";

    // 🔥 FIX: Kurangi slotsTaken (-1) karena beban kerja ini batal dikerjakan
    // Ini berlaku baik untuk Pre-Order (Hapus) maupun Antrean Aktif (Batal)
    await Event.findByIdAndUpdate(event._id, {
      $inc: { slotsTaken: -1 },
    });

    if (isPreOrder) {
      const isLatest = entry.nomorAntrian === event.lastNumberIssued;

      // Hapus data antrean secara permanen (Hard Delete)
      await QueueEntry.findByIdAndDelete(queueId);

      // Jika yang batal adalah nomor terakhir, mundurkan counter nomor
      if (isLatest) {
        await Event.findByIdAndUpdate(event._id, {
          $inc: { lastNumberIssued: -1 },
        });
      }
      return res.status(200).json({
        success: true,
        message:
          "Pendaftaran Pre-Order berhasil dibatalkan. Slot dikembalikan.",
      });
    } else {
      // Ubah status jadi DIBATALKAN (Soft Delete)
      entry.statusAntrian = "DIBATALKAN";
      entry.alasanBatal = req.body.alasan || "Dibatalkan oleh pengguna";
      entry.waktuSelesai = new Date(); // Catat waktu pembatalan
      await entry.save();

      return res.status(200).json({
        success: true,
        message: "Antrean aktif berhasil dibatalkan. Slot dikembalikan.",
      });
    }
  } catch (err) {
    console.error("🚨 System Error [userCancelQueue]:", err);
    res
      .status(500)
      .json({ success: false, message: "Gagal membatalkan antrean." });
  }
};

exports.exportQueueToExcel = async (req, res) => {
  const { eventId } = req.params;
  const { batch } = req.query;

  try {
    const event = await Event.findById(eventId);
    if (!event)
      return res.status(404).json({ message: "Event tidak ditemukan" });

    // Filter Batch
    let filter = { event: eventId };
    if (batch) filter.batch = parseInt(batch);

    // 🔥 1. POPULATE SEMUA FIELD BIODATA (Nama, NIS, Kelas, Sekolah, Ortu, Alamat, dll)
    const queues = await QueueEntry.find(filter)
      .populate(
        "pengguna",
        "namaPengguna email noHp nis fotoProfil kelas namaSekolah namaOrangTua alamat jenisKelamin tanggalLahir"
      )
      .sort({ batch: 1, nomorAntrian: 1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Laporan Lengkap");

    // --- HEADER JUDUL (Styling) ---
    worksheet.mergeCells("A1:O1"); // Merge sampai kolom O
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `LAPORAN LENGKAP: ${event.namaKegiatan.toUpperCase()} ${
      batch ? "(BATCH " + batch + ")" : ""
    }`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3E5F5" },
    }; // Ungu Muda

    worksheet.mergeCells("A2:O2");
    worksheet.getCell("A2").value = `Total Data: ${
      queues.length
    } Peserta | Lokasi: ${event.lokasiKegiatan || "-"}`;
    worksheet.getCell("A2").alignment = { horizontal: "center" };

    worksheet.addRow([]);

    // --- HEADER TABEL (KOMPLIT) ---
    const headers = [
      "Batch", // A
      "No. Antre", // B
      "Status", // C
      "Nama Lengkap", // D
      "NIS / NIK", // E
      "L/P", // F (Gender)
      "Kelas", // G
      "Asal Sekolah", // H
      "Nama Orang Tua", // I
      "No HP (WA)", // J
      "Email", // K
      "Alamat", // L
      "Waktu Daftar", // M
      "Waktu Selesai", // N
      "Foto Profil", // O
    ];

    const headerRow = worksheet.getRow(4);
    headerRow.values = headers;

    // Style Header: Warna Ungu Tua, Teks Putih, Bold
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF7C3AED" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // --- ISI DATA ---
    queues.forEach((q) => {
      const u = q.pengguna || {};

      // Helper format tanggal
      const formatDate = (date) =>
        date
          ? new Date(date).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
          : "-";

      const row = worksheet.addRow([
        q.batch || 1,
        q.nomorAntrian,
        q.statusAntrian,
        u.namaPengguna || "Guest",
        u.nis || "-",
        u.jenisKelamin || "-",
        u.kelas || "-",
        u.namaSekolah || "-",
        u.namaOrangTua || "-",
        u.noHp || "-",
        u.email || "-",
        u.alamat || "-",
        formatDate(q.waktuDaftar),
        formatDate(q.waktuSelesaiLayanan), // Waktu selesai dilayani
        u.fotoProfil || "-",
      ]);

      // Styling Baris
      row.alignment = { vertical: "middle", wrapText: true };

      // Center Alignment untuk kolom-kolom pendek
      [1, 2, 3, 5, 6, 13, 14].forEach((colIdx) => {
        row.getCell(colIdx).alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
      });

      // Hyperlink Foto
      if (u.fotoProfil) {
        const cell = row.getCell(15); // Kolom O
        cell.value = { text: "Lihat Foto", hyperlink: u.fotoProfil };
        cell.font = { color: { argb: "FF1E88E5" }, underline: true };
      }
    });

    // --- LEBAR KOLOM (Disesuaikan dengan konten) ---
    worksheet.columns = [
      { width: 8 }, // Batch
      { width: 10 }, // No
      { width: 15 }, // Status
      { width: 30 }, // Nama
      { width: 15 }, // NIS
      { width: 8 }, // LP
      { width: 12 }, // Kelas
      { width: 25 }, // Sekolah
      { width: 25 }, // Ortu
      { width: 18 }, // HP
      { width: 25 }, // Email
      { width: 40 }, // Alamat
      { width: 20 }, // Daftar
      { width: 20 }, // Selesai
      { width: 12 }, // Foto
    ];

    // Kirim Response
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const fileNameSuffix = batch ? `Batch${batch}` : "Full";
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Report_Lengkap_${eventId}_${fileNameSuffix}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel Error:", err);
    res.status(500).json({ message: "Gagal export excel" });
  }
};

// 🔥 FUNGSI 2: UNTUK LIST DI HALAMAN REPORT
exports.getQueueListByEvent = async (req, res) => {
  try {
    const eventId = req.query.eventIdKegiatan;
    if (!eventId)
      return res.status(400).json({ message: "ID Layanan diperlukan." });

    // Cari Event dulu biar aman (bisa pakai ID Mongo atau ID Kegiatan string)
    const event = await Event.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(eventId) ? eventId : null },
        { idKegiatan: eventId },
      ],
    });

    if (!event)
      return res.status(404).json({ message: "Layanan tidak ditemukan" });

    const list = await QueueEntry.find({ event: event._id })
      .sort({ nomorAntrian: 1 })
      .populate("pengguna", "namaPengguna email"); // Ambil nama & email user

    res.json(list);
  } catch (e) {
    console.error("🚨 System Error [getQueueListByEvent]:", e);
    res.status(500).json({ message: "Gagal memuat daftar antrean." });
  }
};

exports.seedQueue = async (req, res) => {
  const { eventId, jumlah } = req.body;
  const count = jumlah || 10;

  try {
    // 1. Cari Event (Tetap Hybrid agar mudah testing pakai "BK-001")
    const event = mongoose.Types.ObjectId.isValid(eventId)
      ? await Event.findById(eventId)
      : await Event.findOne({ idKegiatan: eventId });

    if (!event) {
      return res.status(404).json({
        message:
          "Layanan tidak ditemukan. Pastikan ID MongoDB atau Kode Kegiatan benar.",
      });
    }

    let currentNumber = event.lastNumberIssued || 0;
    const batchAktif = event.currentBatch || 1;

    console.log(
      `[SEED] Memulai pendaftaran ${count} bot untuk: ${event.namaKegiatan}`
    );

    const createdQueues = [];

    for (let i = 1; i <= count; i++) {
      currentNumber++;
      const rnd = Math.random().toString(36).substring(7);

      // 2. Buat User Bot
      const botUser = await User.create({
        namaPengguna: `Siswa Bot #${currentNumber}`,
        email: `bot_${rnd}@test.com`,
        firebaseUid: `BOT_${rnd}`,
        peran: "PENGGUNA",
        passwordHash: "seeded_bot_password_hash",
      });

      // 3. Generate ID Antrean manual
      const botQueueId = new mongoose.Types.ObjectId();

      // 4. 🔥 PERBAIKAN UTAMA: Tambahkan .toString() agar Payload JWT bersih
      const virtualToken = jwt.sign(
        {
          qid: botQueueId.toString(), // Wajib String!
          eid: event._id.toString(), // Wajib String!
        },
        SECRET_KEY,
        { expiresIn: "24h" }
      );

      // 5. Simpan QueueEntry
      const q = await QueueEntry.create({
        _id: botQueueId,
        event: event._id, // Masuk sebagai ObjectId asli
        pengguna: botUser._id,
        nomorAntrian: currentNumber,
        batch: batchAktif,
        statusAntrian: "MENUNGGU",
        qrToken: virtualToken,
        qrExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      createdQueues.push(q);
    }

    // 6. Update Statistik Event
    event.lastNumberIssued = currentNumber;
    event.slotsTaken = (event.slotsTaken || 0) + count;
    await event.save();

    res.json({
      success: true,
      message: `Berhasil menambahkan ${count} bot ke kegiatan: ${event.namaKegiatan}`,
      data: {
        totalTerdaftar: event.slotsTaken,
        nomorTerakhir: event.lastNumberIssued,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      console.error(
        "🚨 Seeding Error: Duplikasi Data (Coba lagi, random collision)."
      );
    } else {
      console.error("🚨 System Error [seedQueue]:", err);
    }
    res.status(500).json({ message: "Gagal seeding.", error: err.message });
  }
};

exports.cancelAllQueuesByUser = async (req, res) => {
  const { userId } = req.body;

  try {
    
    if (!userId) {
      return res.status(400).json({ message: "User ID wajib dikirim." });
    }

    // 1. Cari antrean aktif menggunakan 'QueueEntry'
    const activeQueues = await QueueEntry.find({
      pengguna: userId,
      statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA"] },
    });

    if (activeQueues.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Tidak ada antrean aktif untuk dibatalkan.",
        data: { modifiedCount: 0 },
      });
    }

    // 2. Update status antrean menjadi DIBATALKAN menggunakan 'QueueEntry'
    const result = await QueueEntry.updateMany(
      {
        pengguna: userId,
        statusAntrian: { $in: ["MENUNGGU", "DIPANGGIL", "REQ_TUNDA"] },
      },
      {
        $set: {
          statusAntrian: "DIBATALKAN",
          alasanBatal: "Dibatalkan Admin Sekolah (Bulk Action)",
          waktuSelesai: new Date(),
        },
      }
    );

    // 3. Kembalikan slot kuota (slotsTaken -1) pada Event terkait
    const updatePromises = activeQueues.map((q) =>
      Event.findByIdAndUpdate(q.event, { $inc: { slotsTaken: -1 } })
    );
    await Promise.all(updatePromises);

    return res.status(200).json({
      success: true,
      message: `Berhasil membatalkan ${result.modifiedCount} antrian aktif.`,
      data: result,
    });
  } catch (error) {
    console.error("🚨 System Error [cancelAllQueuesByUser]:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server saat membatalkan antrean.",
      error: error.message,
    });
  }
};

const runGlobalScheduler = async () => {
  try {
    const events = await Event.find({
      statusKegiatan: { $in: ["TERBUKA", "DITUTUP"] },
      isLocked: true,
    });

    for (const evt of events) {
      await processAutoActions(evt._id);
    }
  } catch (err) {
    console.error("🚨 System Error [Cron Global Scheduler]:", err);
  }
};

exports.runGlobalScheduler = runGlobalScheduler;
exports.completeService = exports.adminCompleteQueue;
