const mongoose = require("mongoose");

/**
 * Event Schema:
 * Mendefinisikan kegiatan layanan antrean di sekolah.
 */
const eventSchema = new mongoose.Schema(
  {
    sekolah: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    thumbnailUrl: {
      type: String,
      default: null,
    },
    idKegiatan: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    namaKegiatan: {
      type: String,
      required: true,
      trim: true,
    },
    deskripsi: {
      type: String,
      trim: true,
    },
    kategori: {
      type: String,
      enum: [
        "Administrasi (TU)",
        "Akademik & Ujian",
        "Keuangan",
        "Konseling (BK)",
        "Koperasi",
        "Perpustakaan",
        "Kantin",
        "UKS / Kesehatan",
        "Laboratorium",
        "Vaksinasi",
        "Lainnya",
      ],
      default: "Lainnya",
      required: true,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lokasiKegiatan: {
      type: String,
      trim: true,
    },

    gracePeriodMinutes: {
      type: Number,
      default: 5,
    },

    avgServiceMinutes: {
      type: Number,
      default: 5,
    },

    totalServiceDuration: { type: Number, default: 0 },

    totalServed: { type: Number, default: 0 },

    statusKegiatan: {
      type: String,
      enum: ["TERBUKA", "DITUTUP", "SELESAI"],
      default: "TERBUKA",
      required: true,
    },
    kapasitas: {
      type: Number,
      default: null,
    },
    waktuMulai: {
      type: Date,
      default: null,
    },
    waktuSelesai: {
      type: Date,
      default: null,
    },

    currentBatch: {
      type: Number,
      default: 1,
    },

    slotsTaken: {
      type: Number,
      default: 0,
    },
    lastNumberIssued: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

eventSchema.index({ sekolah: 1, statusKegiatan: 1 });
eventSchema.index({ idKegiatan: 1 }, { unique: true });

eventSchema.pre("save", async function () {
  if (this.waktuMulai && this.waktuSelesai) {
    const durasi =
      (new Date(this.waktuSelesai) - new Date(this.waktuMulai)) / 60000;
    if (durasi < 15) {
      throw new Error("Jadwal pelayanan minimal harus 15 menit.");
    }
  }
});

eventSchema.virtual("dynamicStatus").get(function () {
  const now = new Date();

  if (
    this.statusKegiatan === "SELESAI" ||
    (this.waktuSelesai && now > this.waktuSelesai)
  ) {
    return "SELESAI";
  }

  const preCloseTime = this.waktuSelesai
    ? new Date(this.waktuSelesai.getTime() - 15 * 60000)
    : null;

  if (
    this.statusKegiatan === "DITUTUP" ||
    (preCloseTime && now > preCloseTime)
  ) {
    return "DITUTUP";
  }

  if (this.waktuMulai && now < this.waktuMulai) return "PRE-ORDER";
  if (this.kapasitas && this.slotsTaken >= this.kapasitas) return "PENUH";

  return "TERBUKA";
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;
